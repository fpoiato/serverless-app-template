import { Injectable, inject } from '@angular/core';
import type { ClientErrorEventInput } from '@app/shared';
import { APP_CONFIG } from '../config/app-config';

export type ReportInput = Omit<
  ClientErrorEventInput,
  'url' | 'route' | 'timestamp' | 'appVersion' | 'color' | 'sessionId' | 'userAgent'
>;

export const REPORTER_LIMITS = {
  debounceMs: 2_000,
  maxBatch: 20, // igual ao limite do backend
  maxPerSession: 50,
  maxSameError: 3,
};

/**
 * Coleta erros do navegador e envia em lote para `POST /client-errors`.
 * Nunca lança e nunca usa console.* (evita loop com a captura de console).
 */
@Injectable({ providedIn: 'root' })
export class ErrorReporter {
  private readonly config = inject(APP_CONFIG);
  private readonly sessionId = crypto.randomUUID();
  private queue: ClientErrorEventInput[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sent = 0;
  private readonly seen = new Map<string, number>();
  readonly endpoint = `${this.config.apiUrl}/client-errors`;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flush(true));
    }
  }

  report(input: ReportInput): void {
    try {
      const key = `${input.type}|${input.message}|${(input.stack ?? '').slice(0, 300)}`;
      const count = (this.seen.get(key) ?? 0) + 1;
      this.seen.set(key, count);
      if (count > REPORTER_LIMITS.maxSameError) return;
      if (this.sent + this.queue.length >= REPORTER_LIMITS.maxPerSession) return;

      this.queue.push({
        ...input,
        url: location.href,
        // Caminho real da página: o roteador pode ainda não ter concluído a 1ª navegação.
        route: location.pathname,
        timestamp: new Date().toISOString(),
        appVersion: this.config.appVersion,
        color: this.config.color,
        sessionId: this.sessionId,
        userAgent: navigator.userAgent,
      });
      if (this.queue.length >= REPORTER_LIMITS.maxBatch) this.flush();
      else this.schedule();
    } catch {
      // reportar erro nunca pode quebrar o app
    }
  }

  /** Envia o que estiver na fila. `beacon` no fechamento da página. */
  flush(beacon = false): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.queue.length) return;
    const events = this.queue.splice(0, REPORTER_LIMITS.maxBatch);
    this.sent += events.length;
    // text/plain evita preflight e é o único tipo aceito pelo sendBeacon; o backend lê JSON.
    const body = JSON.stringify({ events });
    try {
      if (beacon && navigator.sendBeacon?.(this.endpoint, body)) return;
      void fetch(this.endpoint, {
        method: 'POST',
        body,
        keepalive: true,
        headers: { 'Content-Type': 'text/plain' },
      }).catch(() => undefined);
    } catch {
      // sem rede: descarta
    }
    if (this.queue.length) this.schedule();
  }

  private schedule(): void {
    this.timer ??= setTimeout(() => this.flush(), REPORTER_LIMITS.debounceMs);
  }
}
