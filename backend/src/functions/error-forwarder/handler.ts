import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  ResourceAlreadyExistsException,
} from '@aws-sdk/client-cloudwatch-logs';
import { Logger, withHandler } from '@app/shared';
import type { CloudWatchLogsEvent, Context } from 'aws-lambda';
import { type CentralError, toCentralError } from '../../lib/central-error.js';
import { decodeLogsEvent } from '../../lib/cloudwatch-logs.js';

/**
 * Recebe, via subscription filter, as linhas suspeitas de erro de todas as Lambdas do projeto
 * e grava somente os erros reais, normalizados, no log group central `/<slug>/errors`.
 * Este log group não é assinado por ele mesmo (sem recursão): falhas aqui ficam no log
 * próprio do forwarder e no alarme de erros da função.
 */
const logger = new Logger('error-forwarder');
export const cwl = new CloudWatchLogsClient({});

async function ensureStream(group: string, stream: string): Promise<void> {
  try {
    await cwl.send(new CreateLogStreamCommand({ logGroupName: group, logStreamName: stream }));
  } catch (err) {
    if (!(err instanceof ResourceAlreadyExistsException)) throw err;
  }
}

export const handler = withHandler(logger, async (event: CloudWatchLogsEvent, _ctx: Context) => {
  const data = decodeLogsEvent(event);
  if (data.messageType !== 'DATA_MESSAGE') return { forwarded: 0 };

  const errors = data.logEvents
    .map((e) => toCentralError(data.logGroup, data.logStream, e))
    .filter((e): e is CentralError => e !== null);
  if (errors.length === 0) return { forwarded: 0 };

  const group = process.env.CENTRAL_ERRORS_LOG_GROUP!;
  const day = new Date().toISOString().slice(0, 10);
  const stream = `${day}/${errors[0]!.function}`;
  await ensureStream(group, stream);
  await cwl.send(
    new PutLogEventsCommand({
      logGroupName: group,
      logStreamName: stream,
      logEvents: errors
        .map((e) => ({
          timestamp: Date.parse(e.timestamp) || Date.now(),
          message: JSON.stringify(e),
        }))
        .sort((a, b) => a.timestamp - b.timestamp),
    }),
  );
  logger.info('forwarded', { count: errors.length, function: errors[0]!.function });
  return { forwarded: errors.length };
});
