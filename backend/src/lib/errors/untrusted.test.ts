import { describe, expect, it } from 'vitest';
import { neutralize } from './untrusted.js';

describe('neutralize', () => {
  it('não deixa menções notificarem ninguém', () => {
    expect(neutralize('ping @fpoiato')).not.toMatch(/@fpoiato/);
  });

  it('não deixa fechar o bloco de código da evidência', () => {
    expect(neutralize('```\n# instruções')).not.toContain('```');
  });

  it('neutraliza palavras de fechamento de issue', () => {
    expect(neutralize('closes #12 e Fixes #3')).not.toMatch(/closes #12|Fixes #3/);
  });

  it('limita o tamanho', () => {
    expect(neutralize('x'.repeat(100), 10)).toBe(`${'x'.repeat(10)}…[truncado]`);
  });
});
