/** Chaves cujo valor é sempre removido, independentemente do conteúdo. */
const SENSITIVE_KEY =
  /(e-?mail|phone|telefone|celular|whats|cpf|cnpj|rg\b|password|senha|token|authorization|cookie|secret|api[-_]?key|card|cart[aã]o|cvv|iban|conta)/i;

const PATTERNS: [RegExp, string][] = [
  [/\b[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]{10,}\b/g, '[jwt]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]'],
  [/(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[telefone]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[cartao]'],
];

export const REDACTED = '[redacted]';

/** Remove dados pessoais e segredos de textos livres (mensagens, stacks, URLs). */
export function redactText(text: string): string {
  return PATTERNS.reduce((acc, [re, replacement]) => acc.replace(re, replacement), text);
}

/** Cópia profunda com chaves sensíveis removidas e textos redigidos. Tolera ciclos. */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) return serializeError(value, seen);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, seen);
  }
  return out;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

export function serializeError(err: unknown, seen = new WeakSet<object>()): SerializedError {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: redactText(err.message),
      ...(err.stack ? { stack: redactText(err.stack) } : {}),
      ...(err.cause !== undefined ? { cause: redact(err.cause, seen) } : {}),
    };
  }
  return { name: 'NonError', message: redactText(String(err)) };
}
