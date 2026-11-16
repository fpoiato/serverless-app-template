import { z } from 'zod';

/** Contrato do POST /client-errors (frontend → backend). */
export const CLIENT_ERROR_TYPES = [
  'js', // window.onerror / ErrorHandler do Angular
  'promise', // unhandledrejection
  'http', // resposta 4xx/5xx relevante
  'network', // status 0: rede, CORS, DNS, offline
  'csp', // securitypolicyviolation
  'chunk-load', // falha ao carregar chunk lazy
  'console', // console.error
] as const;

export const MAX_CLIENT_ERRORS_PER_REQUEST = 20;
export const MAX_CLIENT_ERRORS_BODY_BYTES = 32 * 1024;

const text = (max: number) =>
  z.string().transform((s) => (s.length > max ? `${s.slice(0, max)}…` : s));

export const ClientErrorEvent = z.object({
  type: z.enum(CLIENT_ERROR_TYPES),
  message: text(1_000),
  name: text(100).optional(),
  stack: text(4_000).optional(),
  url: text(500), // página onde ocorreu
  route: text(200).optional(), // rota Angular
  timestamp: z.string().datetime(),
  appVersion: text(50),
  color: z.enum(['blue', 'green', 'local']).optional(),
  correlationId: text(100).optional(),
  sessionId: text(64).optional(),
  userAgent: text(300).optional(),
  http: z
    .object({
      method: text(10),
      url: text(500),
      status: z.number().int().min(0).max(599),
      correlationId: text(100).optional(),
    })
    .optional(),
  csp: z.object({ violatedDirective: text(100), blockedURI: text(300).optional() }).optional(),
});
export type ClientErrorEvent = z.infer<typeof ClientErrorEvent>;

export type ClientErrorType = (typeof CLIENT_ERROR_TYPES)[number];

/**
 * Formato enviado pelo frontend, escrito à mão (sem depender dos tipos do zod no Angular).
 * A checagem abaixo garante que continua compatível com o schema.
 */
export interface ClientErrorEventInput {
  type: ClientErrorType;
  message: string;
  name?: string;
  stack?: string;
  url: string;
  route?: string;
  timestamp: string;
  appVersion: string;
  color?: 'blue' | 'green' | 'local';
  correlationId?: string;
  sessionId?: string;
  userAgent?: string;
  http?: { method: string; url: string; status: number; correlationId?: string };
  csp?: { violatedDirective: string; blockedURI?: string };
}

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _schemaMatchesInterface: Exact<
  z.input<typeof ClientErrorEvent>,
  ClientErrorEventInput
> = true;
void _schemaMatchesInterface;

export const ClientErrorsRequest = z.object({
  events: z.array(ClientErrorEvent).min(1).max(MAX_CLIENT_ERRORS_PER_REQUEST),
});
export type ClientErrorsRequest = z.infer<typeof ClientErrorsRequest>;
