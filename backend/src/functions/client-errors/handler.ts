import { ClientErrorsRequest, MAX_CLIENT_ERRORS_BODY_BYTES } from '@app/shared';
import { HttpError, httpHandler, json } from '../../lib/http.js';

/**
 * Recebe erros do frontend e registra cada um como `level=ERROR` com `data.source=frontend`.
 * O pipeline de erros (#8/#9) leva ao /<slug>/errors e às issues. Todo conteúdo aqui é
 * NÃO CONFIÁVEL (vem de qualquer navegador): validado, truncado e redigido pelo logger.
 */
export const handler = httpHandler('client-errors', async (event, _ctx, logger) => {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');
  if (Buffer.byteLength(raw) > MAX_CLIENT_ERRORS_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large', 'Payload muito grande');
  }

  let body: unknown;
  try {
    body = JSON.parse(raw); // sendBeacon envia text/plain; o conteúdo é sempre JSON
  } catch {
    throw new HttpError(400, 'invalid_json', 'JSON inválido');
  }
  const parsed = ClientErrorsRequest.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'invalid_payload', 'Payload inválido');

  const sourceIp = event.requestContext?.identity?.sourceIp;
  for (const e of parsed.data.events) {
    const err = new Error(e.message);
    err.name = e.name ?? `client:${e.type}`;
    err.stack = e.stack ?? `${err.name}: ${e.message}`;
    logger.error(`client error (${e.type})`, err, {
      source: 'frontend',
      type: e.type,
      url: e.url,
      route: e.route,
      appVersion: e.appVersion,
      clientColor: e.color,
      clientCorrelationId: e.correlationId,
      sessionId: e.sessionId,
      userAgent: e.userAgent,
      http: e.http,
      csp: e.csp,
      clientTimestamp: e.timestamp,
      ipPrefix: sourceIp?.split('.').slice(0, 2).join('.'),
    });
  }
  return json(202, { accepted: parsed.data.events.length });
});
