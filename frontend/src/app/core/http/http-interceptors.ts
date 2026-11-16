import { type HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';
import { ErrorReporter } from '../errors/error-reporter';

/** Status 4xx que fazem parte do fluxo normal (validação, login, não encontrado, conflito). */
const EXPECTED_4XX = new Set([400, 401, 403, 404, 409, 422]);

export function shouldReport(status: number): 'network' | 'http' | null {
  if (status === 0) return 'network'; // rede, CORS, DNS, offline, bloqueio
  if (status >= 500) return 'http';
  if (status >= 400 && !EXPECTED_4XX.has(status)) return 'http';
  return null;
}

/** Correlation id em toda chamada à nossa API (rastreável nos logs do backend). */
export const correlationIdInterceptor: HttpInterceptorFn = (req, next) => {
  const { apiUrl } = inject(APP_CONFIG);
  if (!req.url.startsWith(apiUrl) || req.headers.has('X-Correlation-Id')) return next(req);
  return next(req.clone({ setHeaders: { 'X-Correlation-Id': crypto.randomUUID() } }));
};

export const errorReportingInterceptor: HttpInterceptorFn = (req, next) => {
  const reporter = inject(ErrorReporter);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      const type = shouldReport(err.status ?? 0);
      if (type && !req.url.includes('/client-errors')) {
        reporter.report({
          type,
          name: 'HttpErrorResponse',
          message:
            `${req.method} ${req.urlWithParams} → ${err.status} ${err.statusText ?? ''}`.trim(),
          correlationId: req.headers.get('X-Correlation-Id') ?? undefined,
          http: {
            method: req.method,
            url: req.urlWithParams,
            status: err.status ?? 0,
            correlationId: err.headers?.get('X-Correlation-Id') ?? undefined,
          },
        });
      }
      return throwError(() => err);
    }),
  );
};
