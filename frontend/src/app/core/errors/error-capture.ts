import {
  ENVIRONMENT_INITIALIZER,
  ErrorHandler,
  type EnvironmentProviders,
  inject,
  makeEnvironmentProviders,
} from '@angular/core';
import { ErrorReporter } from './error-reporter';
import { GlobalErrorHandler, toReport } from './global-error-handler';

let consolePatched = false;

/** Captura `console.error` (sem quebrar o comportamento original). */
export function patchConsole(reporter: ErrorReporter): void {
  if (consolePatched) return;
  consolePatched = true;
  // eslint-disable-next-line no-console -- captura do console é o objetivo deste código
  const original = console.error.bind(console);
  // eslint-disable-next-line no-console -- captura do console é o objetivo deste código
  console.error = (...args: unknown[]) => {
    original(...args);
    const first = args[0];
    const err = args.find((a): a is Error => a instanceof Error);
    reporter.report({
      type: 'console',
      name: err?.name,
      message:
        args
          .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : String(a)))
          .join(' ')
          .slice(0, 1_000) || String(first),
      stack: err?.stack,
    });
  };
}

/**
 * Erros fora do Angular (`window.onerror`) e promessas rejeitadas sem tratamento.
 * Registrados aqui, e não via provideBrowserGlobalErrorListeners, para manter o tipo correto
 * (`js` x `promise`). Erros dentro do Angular chegam pelo GlobalErrorHandler.
 */
export function listenWindow(reporter: ErrorReporter): void {
  window.addEventListener('error', (e) => {
    if (!(e instanceof ErrorEvent)) return; // falha de recurso (img/script): fora do escopo
    const r = toReport(e.error ?? e.message);
    reporter.report({ ...r, type: r.type === 'chunk-load' ? 'chunk-load' : 'js' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = toReport(e.reason);
    reporter.report({ ...r, type: r.type === 'chunk-load' ? 'chunk-load' : 'promise' });
  });
}

/** Violações de CSP (scripts, estilos, conexões bloqueadas). */
export function listenCsp(reporter: ErrorReporter): void {
  document.addEventListener('securitypolicyviolation', (e) => {
    reporter.report({
      type: 'csp',
      message: `CSP: ${e.violatedDirective} bloqueou ${e.blockedURI || 'inline'}`,
      csp: { violatedDirective: e.violatedDirective, blockedURI: e.blockedURI },
    });
  });
}

export function provideErrorCapture(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useValue: () => {
        const reporter = inject(ErrorReporter);
        patchConsole(reporter);
        listenWindow(reporter);
        listenCsp(reporter);
      },
    },
  ]);
}
