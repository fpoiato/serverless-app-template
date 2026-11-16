import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ddb, handler } from './handler.js';

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
vi.stubEnv('CONNECTIONS_TABLE', 'conns');
const ddbMock = mockClient(ddb);
const apiMock = mockClient(ApiGatewayManagementApiClient);
beforeEach(() => {
  ddbMock.reset();
  apiMock.reset();
});

const ev = (routeKey: string, body?: string) =>
  ({
    body,
    requestContext: {
      routeKey,
      connectionId: 'c1',
      apiId: 'abc',
      domainName: 'ws.x',
      stage: 'blue',
    },
  }) as never;
const ctx = { awsRequestId: 'r' } as Context;

describe('ws-connection', () => {
  it('$connect grava a conexão com TTL', async () => {
    const res = await handler(ev('$connect'), ctx);
    expect(res).toEqual({ statusCode: 200 });
    const item = ddbMock.commandCalls(PutCommand)[0]!.args[0].input.Item!;
    expect(item).toMatchObject({ connectionId: 'c1', color: 'blue', userId: 'anonymous' });
    expect(item.ttl).toBeGreaterThan(Date.now() / 1000);
  });

  it('$disconnect remove a conexão', async () => {
    await handler(ev('$disconnect'), ctx);
    expect(ddbMock.commandCalls(DeleteCommand)[0]!.args[0].input.Key).toEqual({
      connectionId: 'c1',
    });
  });

  it('ping responde pong pelo endpoint execute-api da stage', async () => {
    vi.stubEnv('AWS_REGION', 'us-east-1');
    await handler(ev('$default', JSON.stringify({ action: 'ping' })), ctx);
    const sent = apiMock.commandCalls(PostToConnectionCommand)[0]!.args[0].input;
    expect(sent.ConnectionId).toBe('c1');
    const endpoint = await apiMock.call(0).thisValue.config.endpoint!();
    expect(`${endpoint.hostname}${endpoint.path}`).toBe(
      'abc.execute-api.us-east-1.amazonaws.com/blue',
    );
    expect(JSON.parse(Buffer.from(sent.Data as Uint8Array).toString())).toMatchObject({
      type: 'pong',
    });
  });

  it('corpo inválido retorna 400', async () => {
    expect(await handler(ev('$default', '{x'), ctx)).toEqual({ statusCode: 400 });
  });
});
