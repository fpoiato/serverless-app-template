import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from './handler.js';

const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
afterEach(() => stdout.mockClear());
const logged = () => stdout.mock.calls.map((c) => JSON.parse(String(c[0])));
vi.stubEnv('ALLOWED_ORIGINS', 'https://fcar.fpoiato.com,https://blue.fcar.fpoiato.com');

const ev = (body: string, headers: Record<string, string> = {}) =>
  ({
    body,
    headers: { origin: 'https://fcar.fpoiato.com', ...headers },
    requestContext: { requestId: 'r', identity: { sourceIp: '200.10.20.30' } },
  }) as unknown as APIGatewayProxyEvent;
const ctx = { awsRequestId: 'x' } as Context;
const event = {
  type: 'http',
  message: 'Falha ao listar estoque para ana@x.com',
  stack: 'Error: x\n    at a (https://fcar.fpoiato.com/main-ABCDEFGH.js:1:2)',
  url: 'https://fcar.fpoiato.com/estoque',
  timestamp: '2026-11-16T03:00:00.000Z',
  appVersion: '1.0.0',
  color: 'blue',
  http: { method: 'GET', url: 'https://api.fcar.fpoiato.com/units', status: 500 },
};

describe('client-errors', () => {
  it('registra cada evento como ERROR de origem frontend e responde 202', async () => {
    const res = await handler(
      ev(JSON.stringify({ events: [event, { ...event, type: 'js' }] })),
      ctx,
    );
    expect(res.statusCode).toBe(202);
    expect(res.headers?.['Access-Control-Allow-Origin']).toBe('https://fcar.fpoiato.com');
    const errors = logged().filter((l) => l.level === 'ERROR');
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      message: 'client error (http)',
      error: { name: 'client:http', message: 'Falha ao listar estoque para [email]' },
      data: { source: 'frontend', type: 'http', http: { status: 500 }, ipPrefix: '200.10' },
    });
  });

  it('JSON inválido ou schema inválido → 400 sem log de erro', async () => {
    expect((await handler(ev('{x'), ctx)).statusCode).toBe(400);
    expect((await handler(ev(JSON.stringify({ events: [{ type: 'x' }] })), ctx)).statusCode).toBe(
      400,
    );
    expect(logged().filter((l) => l.level === 'ERROR')).toHaveLength(0);
  });

  it('payload acima do limite → 413', async () => {
    const res = await handler(ev('x'.repeat(40_000)), ctx);
    expect(res.statusCode).toBe(413);
  });

  it('não reflete origens fora da lista', async () => {
    const res = await handler(
      ev(JSON.stringify({ events: [event] }), { origin: 'https://evil.example' }),
      ctx,
    );
    expect(res.headers?.['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('aceita corpo em base64 (sendBeacon via API Gateway)', async () => {
    const e = ev(Buffer.from(JSON.stringify({ events: [event] })).toString('base64'));
    e.isBase64Encoded = true;
    expect((await handler(e, ctx)).statusCode).toBe(202);
  });
});
