import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const table = () => process.env.TABLE_NAME!;

/** Registro de um fingerprint de erro (PK `ERRFP#<fp>`, SK `META`). */
export interface FingerprintRecord {
  PK: string;
  SK: 'META';
  fingerprint: string;
  total: number;
  pending: number;
  firstSeen: string;
  lastSeen: string;
  issueNumber?: number;
  lastCommentAt?: string;
  lockUntil?: number;
}

const key = (fp: string) => ({ PK: `ERRFP#${fp}`, SK: 'META' });

async function conditional<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return null;
    throw err;
  }
}

/** Soma `n` ocorrências e devolve o registro atualizado. */
export async function recordOccurrences(
  fp: string,
  n: number,
  at: string,
): Promise<FingerprintRecord> {
  const res = await ddb.send(
    new UpdateCommand({
      TableName: table(),
      Key: key(fp),
      UpdateExpression:
        'ADD #total :n, #pending :n SET #lastSeen = :at, #firstSeen = if_not_exists(#firstSeen, :at), #fp = :fp',
      ExpressionAttributeNames: {
        '#total': 'total',
        '#pending': 'pending',
        '#lastSeen': 'lastSeen',
        '#firstSeen': 'firstSeen',
        '#fp': 'fingerprint',
      },
      ExpressionAttributeValues: { ':n': n, ':at': at, ':fp': fp },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return res.Attributes as FingerprintRecord;
}

/** Trava para criar a issue; só um worker vence. */
export async function acquireCreateLock(
  fp: string,
  nowSec: number,
  ttlSec = 120,
): Promise<boolean> {
  const ok = await conditional(() =>
    ddb.send(
      new UpdateCommand({
        TableName: table(),
        Key: key(fp),
        UpdateExpression: 'SET lockUntil = :until',
        ConditionExpression:
          'attribute_not_exists(issueNumber) AND (attribute_not_exists(lockUntil) OR lockUntil < :now)',
        ExpressionAttributeValues: { ':until': nowSec + ttlSec, ':now': nowSec },
      }),
    ),
  );
  return ok !== null;
}

export async function releaseLock(fp: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({ TableName: table(), Key: key(fp), UpdateExpression: 'REMOVE lockUntil' }),
  );
}

/** Associa a issue criada e zera as ocorrências pendentes de registro. */
export async function linkIssue(fp: string, issueNumber: number, at: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: table(),
      Key: key(fp),
      UpdateExpression:
        'SET issueNumber = :n, lastCommentAt = :at, pending = :zero REMOVE lockUntil',
      ExpressionAttributeValues: { ':n': issueNumber, ':at': at, ':zero': 0 },
    }),
  );
}

/**
 * Reivindica o direito de comentar (no máximo 1 comentário por intervalo).
 * Devolve quantas ocorrências pendentes o comentário deve relatar, ou null se outro worker comentou.
 */
export async function claimComment(rec: FingerprintRecord, at: string): Promise<number | null> {
  const ok = await conditional(() =>
    ddb.send(
      new UpdateCommand({
        TableName: table(),
        Key: key(rec.fingerprint),
        UpdateExpression: 'SET lastCommentAt = :at, pending = pending - :p',
        ConditionExpression: 'lastCommentAt = :prev',
        ExpressionAttributeValues: { ':at': at, ':prev': rec.lastCommentAt, ':p': rec.pending },
      }),
    ),
  );
  return ok === null ? null : rec.pending;
}

/** Limite global de issues criadas por hora (custo e spam). */
export async function takeIssueBudget(now: Date, maxPerHour: number): Promise<boolean> {
  const hour = now.toISOString().slice(0, 13);
  const ok = await conditional(() =>
    ddb.send(
      new UpdateCommand({
        TableName: table(),
        Key: { PK: `ERRRATE#${hour}`, SK: 'META' },
        UpdateExpression: 'ADD #c :one SET #ttl = :ttl',
        ConditionExpression: 'attribute_not_exists(#c) OR #c < :max',
        ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':max': maxPerHour,
          ':ttl': Math.floor(now.getTime() / 1000) + 2 * 86_400,
        },
      }),
    ),
  );
  return ok !== null;
}
