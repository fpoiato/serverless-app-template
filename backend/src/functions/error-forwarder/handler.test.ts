import { gzipSync } from 'node:zlib';
import {
  CreateLogStreamCommand,
  PutLogEventsCommand,
  ResourceAlreadyExistsException,
} from '@aws-sdk/client-cloudwatch-logs';
import type { CloudWatchLogsEvent, Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cwl, handler } from './handler.js';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
vi.stubEnv('CENTRAL_ERRORS_LOG_GROUP', '/<slug>/errors');
const mock = mockClient(cwl);
beforeEach(() => mock.reset());

const ctx = { awsRequestId: 'r' } as Context;
const wrap = (payload: object): CloudWatchLogsEvent => ({
  awslogs: { data: gzipSync(JSON.stringify(payload)).toString('base64') },
});
const err = JSON.stringify({
  level: 'ERROR',
  message: 'boom',
  error: { name: 'Error', message: 'x' },
});
const info = JSON.stringify({ level: 'INFO', message: 'ok' });

describe('error-forwarder', () => {
  it('grava somente os erros no log group central', async () => {
    const res = await handler(
      wrap({
        messageType: 'DATA_MESSAGE',
        logGroup: '/aws/lambda/fcar-health',
        logStream: 's',
        logEvents: [
          { id: '1', timestamp: 2, message: err },
          { id: '2', timestamp: 1, message: info },
          { id: '3', timestamp: 1, message: '... Task timed out after 3.00 seconds' },
        ],
      }),
      ctx,
    );
    expect(res).toEqual({ forwarded: 2 });
    const put = mock.commandCalls(PutLogEventsCommand)[0]!.args[0].input;
    expect(put.logGroupName).toBe('/<slug>/errors');
    expect(put.logStreamName).toMatch(/^\d{4}-\d{2}-\d{2}\/fcar-health$/);
    expect(put.logEvents!.map((e) => JSON.parse(e.message!).kind)).toEqual([
      'timeout',
      'exception',
    ]);
  });

  it('tolera stream já existente', async () => {
    mock
      .on(CreateLogStreamCommand)
      .rejects(new ResourceAlreadyExistsException({ message: 'exists', $metadata: {} }));
    const res = await handler(
      wrap({
        messageType: 'DATA_MESSAGE',
        logGroup: '/aws/lambda/fcar-x',
        logStream: 's',
        logEvents: [{ id: '1', timestamp: 1, message: err }],
      }),
      ctx,
    );
    expect(res).toEqual({ forwarded: 1 });
  });

  it('não escreve nada sem erros ou em mensagens de controle', async () => {
    await handler(
      wrap({ messageType: 'CONTROL_MESSAGE', logGroup: 'g', logStream: 's', logEvents: [] }),
      ctx,
    );
    await handler(
      wrap({
        messageType: 'DATA_MESSAGE',
        logGroup: 'g',
        logStream: 's',
        logEvents: [{ id: '1', timestamp: 1, message: info }],
      }),
      ctx,
    );
    expect(mock.commandCalls(PutLogEventsCommand)).toHaveLength(0);
  });

  it('falha de escrita propaga (fica no log próprio e no alarme)', async () => {
    mock.on(PutLogEventsCommand).rejects(new Error('throttled'));
    await expect(
      handler(
        wrap({
          messageType: 'DATA_MESSAGE',
          logGroup: '/aws/lambda/fcar-x',
          logStream: 's',
          logEvents: [{ id: '1', timestamp: 1, message: err }],
        }),
        ctx,
      ),
    ).rejects.toThrow('throttled');
  });
});
