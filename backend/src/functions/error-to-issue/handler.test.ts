import { gzipSync } from 'node:zlib';
import type { CloudWatchLogsEvent, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CentralError } from '../../lib/central-error.js';

vi.mock('../../lib/errors/store.js', () => ({
  recordOccurrences: vi.fn(),
  acquireCreateLock: vi.fn(),
  releaseLock: vi.fn(),
  linkIssue: vi.fn(),
  claimComment: vi.fn(),
  takeIssueBudget: vi.fn(),
}));
vi.mock('../../lib/errors/github.js', () => ({
  github: { createIssue: vi.fn(), getIssue: vi.fn(), comment: vi.fn() },
}));

const store = await import('../../lib/errors/store.js');
const { github } = await import('../../lib/errors/github.js');
const { handler, processFingerprint } = await import('./handler.js');

vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
const m = vi.mocked;
const now = new Date('2026-11-16T12:00:00Z');
const err = (over: Partial<CentralError> = {}): CentralError => ({
  timestamp: '2026-11-16T11:59:00Z',
  source: 'backend',
  kind: 'exception',
  function: 'fcar-health',
  logGroup: 'g',
  logStream: 's',
  eventId: '1',
  errorName: 'TypeError',
  message: 'boom',
  ...over,
});
const rec = (over = {}) => ({
  PK: 'ERRFP#f',
  SK: 'META' as const,
  fingerprint: 'f',
  total: 1,
  pending: 1,
  firstSeen: 'a',
  lastSeen: 'b',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m(github.createIssue).mockResolvedValue({ number: 42, state: 'open', html_url: 'u' });
  m(store.takeIssueBudget).mockResolvedValue(true);
  m(store.acquireCreateLock).mockResolvedValue(true);
});

describe('processFingerprint', () => {
  it('erro novo → cria issue e vincula', async () => {
    m(store.recordOccurrences).mockResolvedValue(rec());
    expect(await processFingerprint('f', [err()], now)).toBe('created');
    expect(github.createIssue).toHaveBeenCalledWith(
      '[erro backend] TypeError em fcar-health',
      expect.stringContaining('<!-- analysis:pending -->'),
      expect.arrayContaining(['status:triage', 'type:error-backend']),
    );
    expect(store.linkIssue).toHaveBeenCalledWith('f', 42, now.toISOString());
  });

  it('outro worker criando → não duplica', async () => {
    m(store.recordOccurrences).mockResolvedValue(rec());
    m(store.acquireCreateLock).mockResolvedValue(false);
    expect(await processFingerprint('f', [err()], now)).toBe('locked');
    expect(github.createIssue).not.toHaveBeenCalled();
  });

  it('limite por hora atingido → não cria e libera a trava', async () => {
    m(store.recordOccurrences).mockResolvedValue(rec());
    m(store.takeIssueBudget).mockResolvedValue(false);
    expect(await processFingerprint('f', [err()], now)).toBe('rate-limited');
    expect(store.releaseLock).toHaveBeenCalledWith('f');
  });

  it('falha no GitHub libera a trava e propaga', async () => {
    m(store.recordOccurrences).mockResolvedValue(rec());
    m(github.createIssue).mockRejectedValue(new Error('500'));
    await expect(processFingerprint('f', [err()], now)).rejects.toThrow('500');
    expect(store.releaseLock).toHaveBeenCalled();
  });

  it('recorrência dentro do intervalo → só acumula', async () => {
    m(store.recordOccurrences).mockResolvedValue(
      rec({ issueNumber: 7, pending: 3, lastCommentAt: '2026-11-16T11:30:00Z' }),
    );
    expect(await processFingerprint('f', [err()], now)).toBe('skipped');
    expect(github.comment).not.toHaveBeenCalled();
  });

  it('recorrência após o intervalo → comenta com a contagem', async () => {
    m(store.recordOccurrences).mockResolvedValue(
      rec({ issueNumber: 7, pending: 5, lastCommentAt: '2026-11-16T10:00:00Z' }),
    );
    m(store.claimComment).mockResolvedValue(5);
    m(github.getIssue).mockResolvedValue({ number: 7, state: 'open', html_url: 'u' });
    expect(await processFingerprint('f', [err()], now)).toBe('commented');
    expect(github.comment).toHaveBeenCalledWith(7, expect.stringContaining('**5**'));
  });

  it('issue anterior fechada → cria nova referenciando', async () => {
    m(store.recordOccurrences).mockResolvedValue(
      rec({ issueNumber: 7, pending: 2, lastCommentAt: '2026-11-16T10:00:00Z' }),
    );
    m(store.claimComment).mockResolvedValue(2);
    m(github.getIssue).mockResolvedValue({ number: 7, state: 'closed', html_url: 'u' });
    expect(await processFingerprint('f', [err()], now)).toBe('reopened-as-new');
    expect(m(github.createIssue).mock.calls[0]![1]).toContain('Recorrência de #7');
  });
});

describe('handler', () => {
  it('agrupa por fingerprint e não relança falhas', async () => {
    m(store.recordOccurrences).mockResolvedValue(rec());
    m(github.createIssue).mockRejectedValueOnce(new Error('falhou'));
    const payload = {
      messageType: 'DATA_MESSAGE',
      logGroup: '/<slug>/errors',
      logStream: 's',
      logEvents: [
        { id: '1', timestamp: 1, message: JSON.stringify(err()) },
        { id: '2', timestamp: 2, message: JSON.stringify(err({ eventId: '2' })) },
        { id: '3', timestamp: 3, message: JSON.stringify(err({ function: 'fcar-outra' })) },
        { id: '4', timestamp: 4, message: 'lixo' },
      ],
    };
    const event: CloudWatchLogsEvent = {
      awslogs: { data: gzipSync(JSON.stringify(payload)).toString('base64') },
    };
    const res = await handler(event, { awsRequestId: 'r' } as Context);
    expect(Object.values(res).sort()).toEqual(['created', 'failed']);
    expect(
      m(store.recordOccurrences)
        .mock.calls.map((c) => c[1])
        .sort(),
    ).toEqual([1, 2]);
  });
});
