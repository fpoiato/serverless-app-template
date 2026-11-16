import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Logger, withHandler } from '@app/shared';
import type { APIGatewayProxyWebsocketEventV2, Context } from 'aws-lambda';

const logger = new Logger('ws-connection');
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTION_TTL_SECONDS = 2 * 60 * 60;

type WsEvent = APIGatewayProxyWebsocketEventV2 & { queryStringParameters?: Record<string, string> };

/**
 * $connect / $disconnect / $default. A autenticação via JWT no $connect entra na #16;
 * até lá, conexões são anônimas.
 */
export const handler = withHandler(logger, async (event: WsEvent, _context: Context) => {
  const { routeKey, connectionId, apiId, stage } = event.requestContext;
  const table = process.env.CONNECTIONS_TABLE!;

  switch (routeKey) {
    case '$connect':
      await ddb.send(
        new PutCommand({
          TableName: table,
          Item: {
            connectionId,
            userId: 'anonymous',
            color: stage,
            connectedAt: new Date().toISOString(),
            ttl: Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS,
          },
        }),
      );
      logger.info('connected', { connectionId });
      return { statusCode: 200 };

    case '$disconnect':
      await ddb.send(new DeleteCommand({ TableName: table, Key: { connectionId } }));
      logger.info('disconnected', { connectionId });
      return { statusCode: 200 };

    default: {
      let action: unknown;
      try {
        action = (JSON.parse(event.body ?? '{}') as { action?: unknown }).action;
      } catch {
        return { statusCode: 400 };
      }
      if (action === 'ping') {
        // Sempre o endpoint execute-api: com custom domain, `domainName/stage` não existe.
        const client = new ApiGatewayManagementApiClient({
          endpoint: `https://${apiId}.execute-api.${process.env.AWS_REGION}.amazonaws.com/${stage}`,
        });
        await client.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: Buffer.from(JSON.stringify({ type: 'pong', at: new Date().toISOString() })),
          }),
        );
      }
      return { statusCode: 200 };
    }
  }
});
