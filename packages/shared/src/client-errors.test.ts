import { describe, expect, it } from 'vitest';
import { ClientErrorsRequest } from './client-errors.js';

const ok = {
  type: 'js',
  message: 'x is undefined',
  url: 'https://fcar.fpoiato.com/estoque',
  timestamp: '2026-11-16T03:00:00.000Z',
  appVersion: '1.0.0',
};

describe('ClientErrorsRequest', () => {
  it('aceita um evento válido', () => {
    expect(ClientErrorsRequest.safeParse({ events: [ok] }).success).toBe(true);
  });

  it('rejeita lote vazio, grande demais e tipo desconhecido', () => {
    expect(ClientErrorsRequest.safeParse({ events: [] }).success).toBe(false);
    expect(ClientErrorsRequest.safeParse({ events: Array(21).fill(ok) }).success).toBe(false);
    expect(ClientErrorsRequest.safeParse({ events: [{ ...ok, type: 'xss' }] }).success).toBe(false);
  });

  it('trunca textos longos em vez de rejeitar', () => {
    const r = ClientErrorsRequest.parse({ events: [{ ...ok, message: 'a'.repeat(5_000) }] });
    expect(r.events[0]!.message.length).toBeLessThanOrEqual(1_001);
  });

  it('valida o bloco http', () => {
    const http = { method: 'GET', url: 'https://api.fcar.fpoiato.com/units', status: 0 };
    expect(
      ClientErrorsRequest.safeParse({ events: [{ ...ok, type: 'network', http }] }).success,
    ).toBe(true);
    expect(
      ClientErrorsRequest.safeParse({ events: [{ ...ok, http: { ...http, status: 999 } }] })
        .success,
    ).toBe(false);
  });
});
