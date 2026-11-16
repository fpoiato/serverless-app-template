import { redactText } from '@app/shared';

/** Formato de cada evento gravado no log group central `/<slug>/errors`. */
export interface CentralError {
  timestamp: string;
  source: 'backend' | 'frontend';
  kind: 'exception' | 'timeout' | 'out-of-memory' | 'runtime-exit' | 'init-error';
  function: string;
  logGroup: string;
  logStream: string;
  eventId: string;
  color?: string;
  lambdaVersion?: string;
  appVersion?: string;
  requestId?: string;
  correlationId?: string;
  errorName?: string;
  message: string;
  stack?: string;
  /** Erros do frontend: página, rota e navegador de onde o erro veio. */
  page?: string;
  route?: string;
  userAgent?: string;
  context?: unknown;
}

export interface RawLogEvent {
  id: string;
  timestamp: number;
  message: string;
}

const MAX_MESSAGE = 2_000;
const MAX_STACK = 8_000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const PLATFORM: [RegExp, CentralError['kind'], string][] = [
  [/Task timed out after [\d.]+ seconds/, 'timeout', 'Lambda timeout'],
  [/Runtime\.OutOfMemory|signal: killed/, 'out-of-memory', 'Lambda sem memória'],
  [
    /"errorType":"Runtime\.\w+"|Runtime\.(ImportModuleError|HandlerNotFound|UserCodeSyntaxError)/,
    'init-error',
    'Falha ao iniciar a Lambda',
  ],
  [/Runtime exited/, 'runtime-exit', 'Runtime da Lambda encerrou'],
];

const truncate = (s: string | undefined, max: number) =>
  s === undefined ? undefined : s.length > max ? `${s.slice(0, max)}…[truncado]` : s;

interface JsonLogLine {
  level?: unknown;
  timestamp?: string;
  function?: string;
  color?: string;
  version?: string;
  appVersion?: string;
  requestId?: string;
  correlationId?: string;
  message?: unknown;
  error?: { name?: string; message?: string; stack?: string };
  data?: {
    source?: unknown;
    appVersion?: string;
    clientColor?: string;
    url?: string;
    route?: string;
    userAgent?: string;
    clientCorrelationId?: string;
    [k: string]: unknown;
  };
}

/**
 * Converte uma linha de log de uma Lambda em um CentralError, ou null se não for erro.
 * Linhas JSON do nosso logger contam só com `level=ERROR`; linhas de texto só para falhas
 * da plataforma (timeout, memória, init). "Invoke Error" é ignorado: o wrapper do handler
 * já registra a mesma exceção em JSON.
 */
export function toCentralError(
  logGroup: string,
  logStream: string,
  ev: RawLogEvent,
): CentralError | null {
  const fn = logGroup.replace(/^\/aws\/lambda\//, '');
  const base = { logGroup, logStream, eventId: ev.id, function: fn };
  const text = ev.message.trim();

  if (text.startsWith('{')) {
    let line: JsonLogLine;
    try {
      line = JSON.parse(text) as JsonLogLine;
    } catch {
      line = {};
    }
    if (line.level === 'ERROR') {
      const frontend = line.data?.source === 'frontend';
      // Para erros do navegador, versão/cor/correlação relevantes são as do cliente.
      const d = frontend ? line.data! : undefined;
      return {
        ...base,
        timestamp: line.timestamp ?? new Date(ev.timestamp).toISOString(),
        source: frontend ? 'frontend' : 'backend',
        kind: 'exception',
        function: line.function ?? fn,
        color: d ? d.clientColor : line.color,
        lambdaVersion: line.version,
        appVersion: d ? d.appVersion : line.appVersion,
        requestId: line.requestId,
        correlationId: d?.clientCorrelationId ?? line.correlationId,
        page: d?.url,
        route: d?.route,
        userAgent: d?.userAgent,
        errorName: line.error?.name,
        message: truncate(
          [String(line.message ?? ''), line.error?.message].filter(Boolean).join(': '),
          MAX_MESSAGE,
        )!,
        stack: truncate(line.error?.stack, MAX_STACK),
        context: line.data,
      };
    }
    if (line.level !== undefined) return null;
  }

  for (const [re, kind, title] of PLATFORM) {
    if (re.test(text)) {
      return {
        ...base,
        timestamp: new Date(ev.timestamp).toISOString(),
        source: 'backend',
        kind,
        requestId: UUID.exec(text)?.[0],
        errorName: title,
        message: truncate(redactText(text), MAX_MESSAGE)!,
      };
    }
  }
  return null;
}
