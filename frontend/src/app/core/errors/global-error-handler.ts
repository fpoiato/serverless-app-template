import { ErrorHandler, Injectable, inject } from '@angular/core';
import { ErrorReporter } from './error-reporter';

const CHUNK_LOAD =
  /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed/i;

export function toReport(error: unknown): {
  type: 'js' | 'promise' | 'chunk-load';
  name?: string;
  message: string;
  stack?: string;
} {
  // Angular entrega a rejeição não tratada como { reason } ou a própria razão.
  const value = (error as { rejection?: unknown })?.rejection ?? error;
  const err = value instanceof Error ? value : undefined;
  const message = err?.message ?? (typeof value === 'string' ? value : safeJson(value));
  const type = CHUNK_LOAD.test(message)
    ? 'chunk-load'
    : (error as { rejection?: unknown })?.rejection !== undefined
      ? 'promise'
      : 'js';
  return { type, name: err?.name, message: message || 'Erro desconhecido', stack: err?.stack };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * Recebe os erros que o Angular captura (componentes, templates, sinais, roteador).
 * Erros globais do navegador são registrados em error-capture.ts.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly reporter = inject(ErrorReporter);
  // eslint-disable-next-line no-console -- mantém o erro visível no console do navegador
  private readonly original = console.error.bind(console);

  handleError(error: unknown): void {
    this.reporter.report(toReport(error));
    // Mantém o comportamento padrão de mostrar no console, sem passar pela captura de console.
    this.original('[app]', error);
  }
}
