import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG, buildConfig } from '../config/app-config';
import { ErrorReporter } from '../errors/error-reporter';
import {
  correlationIdInterceptor,
  errorReportingInterceptor,
  shouldReport,
} from './http-interceptors';

describe('shouldReport', () => {
  it('classifica status', () => {
    expect(shouldReport(0)).toBe('network');
    expect(shouldReport(500)).toBe('http');
    expect(shouldReport(503)).toBe('http');
    expect(shouldReport(429)).toBe('http');
    for (const s of [200, 400, 401, 403, 404, 409, 422]) expect(shouldReport(s)).toBeNull();
  });
});

describe('interceptors', () => {
  const report = vi.fn();
  let http: HttpClient;
  let ctrl: HttpTestingController;
  const api = 'https://api-blue.exemplo.com';

  beforeEach(() => {
    report.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: APP_CONFIG, useValue: buildConfig('blue', 't', 'exemplo.com') },
        { provide: ErrorReporter, useValue: { report } },
        provideHttpClient(withInterceptors([correlationIdInterceptor, errorReportingInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  it('adiciona X-Correlation-Id só nas chamadas à nossa API', () => {
    http.get(`${api}/health`).subscribe();
    http.get('https://outro.example/x').subscribe();
    expect(ctrl.expectOne(`${api}/health`).request.headers.get('X-Correlation-Id')).toMatch(/-/);
    expect(ctrl.expectOne('https://outro.example/x').request.headers.has('X-Correlation-Id')).toBe(
      false,
    );
  });

  it('reporta 5xx e falha de rede, não 404', () => {
    const noop = { error: () => undefined };
    http.get(`${api}/a`).subscribe(noop);
    http.get(`${api}/b`).subscribe(noop);
    http.get(`${api}/c`).subscribe(noop);
    ctrl.expectOne(`${api}/a`).flush('x', { status: 500, statusText: 'Server Error' });
    ctrl.expectOne(`${api}/b`).error(new ProgressEvent('error'), { status: 0 });
    ctrl.expectOne(`${api}/c`).flush('x', { status: 404, statusText: 'Not Found' });
    expect(report.mock.calls.map((c) => [c[0].type, c[0].http.status])).toEqual([
      ['http', 500],
      ['network', 0],
    ]);
    expect(report.mock.calls[0]![0].correlationId).toMatch(/-/);
  });

  it('nunca reporta falhas do próprio /client-errors', () => {
    http.post(`${api}/client-errors`, '{}').subscribe({ error: () => undefined });
    ctrl.expectOne(`${api}/client-errors`).flush('x', { status: 500, statusText: 'x' });
    expect(report).not.toHaveBeenCalled();
  });
});
