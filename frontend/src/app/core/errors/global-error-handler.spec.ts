import { describe, expect, it } from 'vitest';
import { toReport } from './global-error-handler';

describe('toReport', () => {
  it('erro comum vira js com stack', () => {
    const r = toReport(new TypeError('x is undefined'));
    expect(r).toMatchObject({ type: 'js', name: 'TypeError', message: 'x is undefined' });
    expect(r.stack).toContain('TypeError');
  });

  it('rejeição não tratada vira promise', () => {
    expect(toReport({ rejection: new Error('falhou') })).toMatchObject({
      type: 'promise',
      message: 'falhou',
    });
  });

  it('falha de chunk lazy é identificada', () => {
    expect(
      toReport(new Error('Failed to fetch dynamically imported module: /chunk-ABC.js')).type,
    ).toBe('chunk-load');
  });

  it('valores que não são Error', () => {
    expect(toReport('texto').message).toBe('texto');
    expect(toReport({ a: 1 }).message).toBe('{"a":1}');
  });
});
