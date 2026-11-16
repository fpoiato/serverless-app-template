import { Logger } from './logger.js';

interface MinimalContext {
  awsRequestId?: string;
}

interface MaybeHttpEvent {
  headers?: Record<string, string | undefined> | null;
  requestContext?: {
    requestId?: string;
    authorizer?: { claims?: { sub?: string } } | null;
  };
}

const CORRELATION_HEADER = 'x-correlation-id';

function correlationIdFrom(event: unknown, fallback?: string): string | undefined {
  const e = event as MaybeHttpEvent | undefined;
  const headers = e?.headers ?? {};
  const fromHeader = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === CORRELATION_HEADER,
  )?.[1];
  return fromHeader ?? e?.requestContext?.requestId ?? fallback;
}

/**
 * Envolve um handler Lambda: define o contexto do log (requestId, correlationId, userId)
 * e garante que qualquer exceção não tratada seja logada com `level=ERROR` antes de ser
 * relançada (a Lambda continua falhando normalmente).
 */
export function withHandler<E, C extends MinimalContext, R>(
  logger: Logger,
  handler: (event: E, context: C) => Promise<R>,
): (event: E, context: C) => Promise<R> {
  return async (event, context) => {
    const requestId = context?.awsRequestId;
    logger.setContext({
      requestId,
      correlationId: correlationIdFrom(event, requestId),
      userId: (event as MaybeHttpEvent | undefined)?.requestContext?.authorizer?.claims?.sub,
    });
    try {
      return await handler(event, context);
    } catch (err) {
      logger.error('Unhandled error', err);
      throw err;
    }
  };
}
