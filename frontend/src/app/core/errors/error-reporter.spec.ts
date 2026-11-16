import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG, buildConfig } from '../config/app-config';
import { ErrorReporter, REPORTER_LIMITS } from './error-reporter';

describe('ErrorReporter', () => {
  let reporter: ErrorReporter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: buildConfig('green', '1.2.3', 'exemplo.com') }],
    });
    reporter = TestBed.inject(ErrorReporter);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const sentEvents = () =>
    fetchMock.mock.calls.flatMap((c) => JSON.parse(c[1].body as string).events);

  it('agrupa erros e envia para a API da mesma cor após o debounce', () => {
    reporter.report({ type: 'js', message: 'a' });
    reporter.report({ type: 'js', message: 'b' });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REPORTER_LIMITS.debounceMs);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api-green.exemplo.com/client-errors');
    expect(init.headers['Content-Type']).toBe('text/plain');
    expect(sentEvents()).toEqual([
      expect.objectContaining({ type: 'js', message: 'a', color: 'green', appVersion: '1.2.3' }),
      expect.objectContaining({ message: 'b' }),
    ]);
  });

  it('o mesmo erro é enviado no máximo 3 vezes por sessão', () => {
    for (let i = 0; i < 10; i++) reporter.report({ type: 'js', message: 'repetido' });
    vi.advanceTimersByTime(REPORTER_LIMITS.debounceMs);
    expect(sentEvents()).toHaveLength(REPORTER_LIMITS.maxSameError);
  });

  it('respeita o limite por sessão e o tamanho de lote', () => {
    for (let i = 0; i < 80; i++) reporter.report({ type: 'js', message: `e${i}` });
    vi.runAllTimers();
    expect(sentEvents()).toHaveLength(REPORTER_LIMITS.maxPerSession);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(call[1].body).events.length).toBeLessThanOrEqual(REPORTER_LIMITS.maxBatch);
    }
  });

  it('no fechamento da página usa sendBeacon', () => {
    const beacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon, userAgent: 'test' });
    reporter.report({ type: 'promise', message: 'x' });
    reporter.flush(true);
    expect(beacon).toHaveBeenCalledWith(reporter.endpoint, expect.stringContaining('"promise"'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha de rede ao reportar não quebra nada', () => {
    fetchMock.mockImplementation(() => {
      throw new Error('offline');
    });
    reporter.report({ type: 'js', message: 'x' });
    expect(() => vi.advanceTimersByTime(REPORTER_LIMITS.debounceMs)).not.toThrow();
  });
});
