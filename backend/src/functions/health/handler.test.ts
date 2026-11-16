import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handler } from './handler.js';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

const call = () =>
  handler(
    {
      headers: {},
      stageVariables: { color: 'green' },
      requestContext: { requestId: 'r' },
    } as unknown as APIGatewayProxyEvent,
    { awsRequestId: 'x' } as Context,
  );

describe('health', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('responde ok com a cor da stage, horário e região', async () => {
    vi.stubEnv('APP_VERSION', '1.2.3');
    vi.stubEnv('AWS_REGION', 'us-east-1');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      status: 'ok',
      color: 'green',
      appVersion: '1.2.3',
      time: '2026-01-02T03:04:05.000Z',
      region: 'us-east-1',
    });
  });

  it('usa region "unknown" quando AWS_REGION está ausente', async () => {
    vi.stubEnv('AWS_REGION', undefined as unknown as string);
    delete process.env.AWS_REGION;
    const res = await call();
    const body = JSON.parse(res.body);
    expect(body.region).toBe('unknown');
    expect(body.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
