import { describe, expect, it } from 'vitest';
import { REDACTED, redact, redactText, serializeError } from './redact.js';

describe('redactText', () => {
  it.each([
    ['contato: joao.silva@exemplo.com.br', 'contato: [email]'],
    ['cpf 123.456.789-09', 'cpf [cpf]'],
    ['cpf 12345678909', 'cpf [cpf]'],
    ['cnpj 12.345.678/0001-90', 'cnpj [cnpj]'],
    ['tel (11) 98765-4321', 'tel [telefone]'],
    ['tel +55 11 987654321', 'tel [telefone]'],
    ['Authorization: Bearer abc.def-123', 'Authorization: Bearer [token]'],
    ['cartão 4111 1111 1111 1111', 'cartão [cartao]'],
  ])('%s', (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it('remove JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redactText(`token=${jwt}`)).toBe('token=[jwt]');
  });

  it('preserva textos sem dados pessoais', () => {
    expect(redactText('Unidade abc-123 não encontrada')).toBe('Unidade abc-123 não encontrada');
  });
});

describe('redact', () => {
  it('remove valores de chaves sensíveis em qualquer profundidade', () => {
    const out = redact({
      user: { email: 'a@b.com', nome: 'Ana', profile: { telefone: '11999998888', cpf: '1' } },
      headers: { Authorization: 'x', 'content-type': 'json' },
      list: [{ password: 'p' }],
    });
    expect(out).toEqual({
      user: { email: REDACTED, nome: 'Ana', profile: { telefone: REDACTED, cpf: REDACTED } },
      headers: { Authorization: REDACTED, 'content-type': 'json' },
      list: [{ password: REDACTED }],
    });
  });

  it('tolera referências circulares', () => {
    const a: Record<string, unknown> = { nome: 'x' };
    a.self = a;
    expect(redact(a)).toEqual({ nome: 'x', self: '[circular]' });
  });
});

describe('serializeError', () => {
  it('serializa Error com stack redigida', () => {
    const e = new Error('falhou para ana@x.com');
    const s = serializeError(e);
    expect(s.name).toBe('Error');
    expect(s.message).toBe('falhou para [email]');
    expect(s.stack).toContain('[email]');
  });

  it('serializa valores que não são Error', () => {
    expect(serializeError('boom')).toEqual({ name: 'NonError', message: 'boom' });
  });
});
