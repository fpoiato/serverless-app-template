import { describe, expect, it } from 'vitest';
import { toCentralError } from './central-error.js';

const ev = (message: string) => ({
  id: 'e1',
  timestamp: Date.parse('2026-11-16T00:00:00Z'),
  message,
});
const conv = (m: string) =>
  toCentralError('/aws/lambda/fcar-health', '2026/11/16/[$LATEST]abc', ev(m));

describe('toCentralError', () => {
  it('converte linha JSON level=ERROR do nosso logger', () => {
    const line = JSON.stringify({
      timestamp: '2026-11-16T00:00:01.000Z',
      level: 'ERROR',
      function: 'fcar-health',
      color: 'blue',
      version: '7',
      requestId: 'req-1',
      correlationId: 'corr-1',
      message: 'Unhandled error',
      error: { name: 'TypeError', message: 'x is undefined', stack: 'TypeError: x\n at a.ts:1' },
    });
    expect(conv(line)).toMatchObject({
      source: 'backend',
      kind: 'exception',
      function: 'fcar-health',
      color: 'blue',
      lambdaVersion: '7',
      requestId: 'req-1',
      correlationId: 'corr-1',
      errorName: 'TypeError',
      message: 'Unhandled error: x is undefined',
      stack: 'TypeError: x\n at a.ts:1',
      eventId: 'e1',
    });
  });

  it('marca erros vindos do frontend', () => {
    const line = JSON.stringify({
      level: 'ERROR',
      message: 'client error',
      data: { source: 'frontend' },
    });
    expect(conv(line)?.source).toBe('frontend');
  });

  it('ignora INFO e WARN, mesmo contendo a palavra ERROR', () => {
    expect(conv(JSON.stringify({ level: 'INFO', message: 'ERROR count = 0' }))).toBeNull();
    expect(conv(JSON.stringify({ level: 'WARN', message: 'x' }))).toBeNull();
  });

  it('detecta timeout da plataforma com requestId', () => {
    const r = conv(
      '2026-11-16T00:00:10.000Z 1b2c3d4e-0000-4000-8000-000000000001 Task timed out after 10.01 seconds',
    );
    expect(r).toMatchObject({
      kind: 'timeout',
      requestId: '1b2c3d4e-0000-4000-8000-000000000001',
      function: 'fcar-health',
    });
  });

  it('detecta falta de memória e erro de inicialização', () => {
    expect(conv('Error: Runtime exited with error: signal: killed Runtime.OutOfMemory')?.kind).toBe(
      'out-of-memory',
    );
    expect(
      conv('2026 undefined ERROR Uncaught Exception {"errorType":"Runtime.ImportModuleError"}')
        ?.kind,
    ).toBe('init-error');
  });

  it('ignora Invoke Error (já registrado em JSON pelo wrapper) e linhas comuns', () => {
    expect(conv('2026\treq\tERROR\tInvoke Error \t{"errorType":"TypeError"}')).toBeNull();
    expect(conv('START RequestId: abc Version: $LATEST')).toBeNull();
  });

  it('trunca stacks enormes', () => {
    const big = JSON.stringify({
      level: 'ERROR',
      message: 'm',
      error: { stack: 'x'.repeat(20_000) },
    });
    expect(conv(big)!.stack!.length).toBeLessThan(8_100);
  });

  it('redige dados pessoais em linhas de texto da plataforma', () => {
    expect(conv('Task timed out after 3.00 seconds para ana@x.com')!.message).toContain('[email]');
  });
});
