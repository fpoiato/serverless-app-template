import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import localePt from '@angular/common/locales/pt';
import { type ApplicationConfig, DEFAULT_CURRENCY_CODE, LOCALE_ID } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideErrorCapture } from './core/errors/error-capture';
import { correlationIdInterceptor, errorReportingInterceptor } from './core/http/http-interceptors';

registerLocaleData(localePt);

export const appConfig: ApplicationConfig = {
  providers: [
    // Captura própria de erros globais (ver error-capture.ts); substitui provideBrowserGlobalErrorListeners.
    provideErrorCapture(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(
      withFetch(),
      withInterceptors([correlationIdInterceptor, errorReportingInterceptor]),
    ),
    { provide: LOCALE_ID, useValue: 'pt-BR' },
    { provide: DEFAULT_CURRENCY_CODE, useValue: 'BRL' },
  ],
};
