import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, httpHandler, json } from './http.js';

const ctx = { awsRequestId: 'req-1' } as Context;
const event = (headers: Record<string, string> = {}) =>
  ({ headers, requestContext: { requestId: 'apigw-1' } }) as unknown as APIGatewayProxyEvent;

const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
afterEach(() => stdout.mockClear());
const logged = () => stdout.mock.calls.map((c) => JSON.parse(String(c[0])));

describe('httpHandler', () => {
  it('propaga o correlationId na resposta', async () => {
    const h = httpHandler('t', async () => json(200, { ok: true }));
    const res = await h(event({ 'x-correlation-id': 'corr-9' }), ctx);
    expect(res.statusCode).toBe(200);
    expect(res.headers?.['X-Correlation-Id']).toBe('corr-9');
  });

  it('HttpError 4xx vira resposta controlada sem log de erro', async () => {
    const h = httpHandler('t', async () => {
      throw new HttpError(404, 'not_found', 'Unidade não encontrada');
    });
    const res = await h(event(), ctx);
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'not_found', correlationId: 'apigw-1' });
    expect(logged().filter((l) => l.level === 'ERROR')).toHaveLength(0);
  });

  it('erro inesperado vira 500 e é logado como ERROR', async () => {
    const h = httpHandler('t', async () => {
      throw new Error('boom');
    });
    const res = await h(event(), ctx);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'internal_error', correlationId: 'apigw-1' });
    expect(logged()).toEqual([
      expect.objectContaining({
        level: 'ERROR',
        error: expect.objectContaining({ message: 'boom' }),
      }),
    ]);
  });
});
