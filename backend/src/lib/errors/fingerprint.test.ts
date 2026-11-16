import { describe, expect, it } from 'vitest';
import type { CentralError } from '../central-error.js';
import { fingerprint, normalizeVolatile, topFrames } from './fingerprint.js';

const base: CentralError = {
  timestamp: '2026-11-16T00:00:00Z',
  source: 'backend',
  kind: 'exception',
  function: 'fcar-health',
  logGroup: 'g',
  logStream: 's',
  eventId: '1',
  errorName: 'TypeError',
  message: 'Unhandled error: x is undefined',
  stack:
    'TypeError: x is undefined\n    at handler (file:///var/task/index.mjs:1:2345)\n    at run (file:///var/task/index.mjs:1:999)',
};

describe('fingerprint', () => {
  it('é estável entre ocorrências com ids, números e posições diferentes', () => {
    const other = {
      ...base,
      eventId: '2',
      requestId: 'abc',
      timestamp: '2026-11-17T00:00:00Z',
      stack: base.stack!.replace(':1:2345', ':1:2399'),
    };
    expect(fingerprint(other)).toBe(fingerprint(base));
  });

  it('difere por função, tipo de erro e origem', () => {
    expect(fingerprint({ ...base, function: 'fcar-x' })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, errorName: 'RangeError' })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, source: 'frontend' })).not.toBe(fingerprint(base));
  });

  it('sem stack, usa a mensagem normalizada', () => {
    const a = {
      ...base,
      stack: undefined,
      message: 'Unidade 123 não encontrada (req 9f8e7d6c-1111-4222-8333-444455556666)',
    };
    const b = {
      ...a,
      message: 'Unidade 456 não encontrada (req 00000000-1111-4222-8333-444455556666)',
    };
    expect(fingerprint(a)).toBe(fingerprint(b));
  });
});

describe('normalizeVolatile / topFrames', () => {
  it('remove hashes de bundle e query strings', () => {
    expect(normalizeVolatile('main-AB12CD34EF.js?v=3:10:20')).toBe('main-<hash>.js?<q>');
  });

  it('pega só frames de stack', () => {
    expect(topFrames(base.stack)).toHaveLength(2);
    expect(topFrames('at a (https://fcar.fpoiato.com/main-ABCDEFGH.js:1:2)')[0]).toContain(
      'main-<hash>.js',
    );
  });
});
