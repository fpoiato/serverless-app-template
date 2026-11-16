import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireCreateLock, claimComment, ddb, takeIssueBudget } from './store.js';

vi.stubEnv('TABLE_NAME', 'fcar-main');
const mock = mockClient(ddb);
beforeEach(() => mock.reset());
const ccf = () => new ConditionalCheckFailedException({ message: 'no', $metadata: {} });

describe('store', () => {
  it('trava de criação só vence sem issue e sem trava válida', async () => {
    expect(await acquireCreateLock('f', 100)).toBe(true);
    const input = mock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ConditionExpression).toContain('attribute_not_exists(issueNumber)');
    mock.on(UpdateCommand).rejects(ccf());
    expect(await acquireCreateLock('f', 100)).toBe(false);
  });

  it('orçamento por hora usa contador condicional com TTL', async () => {
    expect(await takeIssueBudget(new Date('2026-11-16T12:34:00Z'), 10)).toBe(true);
    const input = mock.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.Key).toEqual({ PK: 'ERRRATE#2026-11-16T12', SK: 'META' });
    expect(input.ExpressionAttributeValues![':max']).toBe(10);
    mock.on(UpdateCommand).rejects(ccf());
    expect(await takeIssueBudget(new Date(), 10)).toBe(false);
  });

  it('só um worker reivindica o comentário', async () => {
    const rec = {
      PK: 'p',
      SK: 'META' as const,
      fingerprint: 'f',
      total: 3,
      pending: 3,
      firstSeen: 'a',
      lastSeen: 'b',
      lastCommentAt: 'x',
    };
    expect(await claimComment(rec, 'y')).toBe(3);
    mock.on(UpdateCommand).rejects(ccf());
    expect(await claimComment(rec, 'y')).toBeNull();
  });

  it('erros que não são de condição propagam', async () => {
    mock.on(UpdateCommand).rejects(new Error('throttled'));
    await expect(acquireCreateLock('f', 1)).rejects.toThrow('throttled');
  });
});
