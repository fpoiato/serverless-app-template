import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from './logger.js';
import { withHandler } from './with-handler.js';

function capture(minLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') {
  const lines: Record<string, unknown>[] = [];
  const logger = new Logger('test-svc', (l) => lines.push(JSON.parse(l)), minLevel);
  return { lines, logger };
}

afterEach(() => vi.unstubAllEnvs());

describe('Logger', () => {
  it('escreve JSON com campos fixos', () => {
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'fcar-health');
    vi.stubEnv('APP_COLOR', 'blue');
    const { lines, logger } = capture();
    logger.info('ok', { unitId: 'u1' });
    expect(lines[0]).toMatchObject({
      level: 'INFO',
      service: 'test-svc',
      function: 'fcar-health',
      color: 'blue',
      message: 'ok',
      data: { unitId: 'u1' },
    });
  });

  it('respeita o nível mínimo, mas nunca descarta ERROR', () => {
    const { lines, logger } = capture('WARN');
    logger.info('ignorado');
    logger.error('mantido');
    expect(lines.map((l) => l.level)).toEqual(['ERROR']);
  });

  it('redige dados pessoais em data e contexto', () => {
    const { lines, logger } = capture();
    logger.setContext({ userId: 'u1', email: 'x@y.com' });
    logger.warn('cliente x@y.com', { telefone: '11999998888' });
    expect(lines[0]).toMatchObject({
      email: '[redacted]',
      message: 'cliente [email]',
      data: { telefone: '[redacted]' },
    });
  });
});

describe('withHandler', () => {
  it('define contexto a partir do evento HTTP', async () => {
    const { lines, logger } = capture();
    const h = withHandler(logger, async () => {
      logger.info('dentro');
      return 1;
    });
    await h(
      {
        headers: { 'X-Correlation-Id': 'corr-1' },
        requestContext: { requestId: 'apigw-1', authorizer: { claims: { sub: 'user-1' } } },
      },
      { awsRequestId: 'req-1' },
    );
    expect(lines[0]).toMatchObject({
      requestId: 'req-1',
      correlationId: 'corr-1',
      userId: 'user-1',
    });
  });

  it('usa o requestId do API Gateway ou da Lambda como correlationId', async () => {
    const { lines, logger } = capture();
    const h = withHandler(logger, async () => logger.info('x'));
    await h({ requestContext: { requestId: 'apigw-2' } }, { awsRequestId: 'req-2' });
    await h({}, { awsRequestId: 'req-3' });
    expect(lines.map((l) => l.correlationId)).toEqual(['apigw-2', 'req-3']);
  });

  it('loga ERROR e relança exceções não tratadas', async () => {
    const { lines, logger } = capture();
    const h = withHandler(logger, async () => {
      throw new TypeError('quebrou');
    });
    await expect(h({}, { awsRequestId: 'r' })).rejects.toThrow('quebrou');
    expect(lines[0]).toMatchObject({
      level: 'ERROR',
      message: 'Unhandled error',
      error: { name: 'TypeError', message: 'quebrou' },
    });
  });
});
