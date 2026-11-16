import { redact, serializeError } from './redact.js';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
const ORDER: Record<LogLevel, number> = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

export interface LogContext {
  requestId?: string;
  correlationId?: string;
  userId?: string;
  [key: string]: unknown;
}

export type LogSink = (line: string) => void;

const defaultSink: LogSink = (line) => {
  process.stdout.write(line + '\n');
};

/**
 * Logger JSON de uma linha por evento. O campo `level` é usado pela
 * subscription filter que alimenta o log group central `/<slug>/errors`.
 */
export class Logger {
  private context: LogContext = {};

  constructor(
    private readonly service: string,
    private readonly sink: LogSink = defaultSink,
    private readonly minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'INFO',
  ) {}

  setContext(ctx: LogContext): void {
    this.context = { ...ctx };
  }

  appendContext(ctx: LogContext): void {
    this.context = { ...this.context, ...ctx };
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.write('DEBUG', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write('INFO', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write('WARN', message, data);
  }

  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    this.write('ERROR', message, data, error);
  }

  private write(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: unknown,
  ): void {
    if (ORDER[level] < ORDER[this.minLevel] && level !== 'ERROR') return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      function: process.env.AWS_LAMBDA_FUNCTION_NAME,
      version: process.env.AWS_LAMBDA_FUNCTION_VERSION,
      color: process.env.APP_COLOR,
      appVersion: process.env.APP_VERSION,
      ...(redact(this.context) as object),
      message: redact(message),
      ...(data ? { data: redact(data) } : {}),
      ...(error !== undefined ? { error: serializeError(error) } : {}),
    };
    this.sink(JSON.stringify(entry));
  }
}
