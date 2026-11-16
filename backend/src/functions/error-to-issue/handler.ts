import { Logger, redact, withHandler } from '@app/shared';
import type { CloudWatchLogsEvent, Context } from 'aws-lambda';
import type { CentralError } from '../../lib/central-error.js';
import { decodeLogsEvent } from '../../lib/cloudwatch-logs.js';
import { fingerprint } from '../../lib/errors/fingerprint.js';
import { github } from '../../lib/errors/github.js';
import {
  issueBody,
  issueLabels,
  issueTitle,
  recurrenceComment,
} from '../../lib/errors/issue-body.js';
import {
  type FingerprintRecord,
  acquireCreateLock,
  claimComment,
  linkIssue,
  recordOccurrences,
  releaseLock,
  takeIssueBudget,
} from '../../lib/errors/store.js';

/**
 * Assina o `/<slug>/errors`. Para cada assinatura de erro (fingerprint):
 * - primeira vez: cria uma issue em Triage com marcador de análise pendente (o Claude no GitHub Actions analisa; limite global por hora)
 * - recorrência: acumula e comenta no máximo uma vez por intervalo
 * - issue fechada e o erro voltou: cria nova issue referenciando a anterior
 * Não é assinado pelo pipeline de erros (evita loop); falhas ficam no log próprio + alarme.
 */
const logger = new Logger('error-to-issue');

const MAX_ISSUES_PER_HOUR = Number(process.env.MAX_ISSUES_PER_HOUR ?? 10);
const COMMENT_INTERVAL_MS = Number(process.env.COMMENT_INTERVAL_MINUTES ?? 60) * 60_000;

export type Outcome =
  'created' | 'commented' | 'reopened-as-new' | 'skipped' | 'rate-limited' | 'locked';

function parse(message: string): CentralError | null {
  try {
    const e = JSON.parse(message) as CentralError;
    return e && typeof e.message === 'string' && typeof e.function === 'string' ? e : null;
  } catch {
    return null;
  }
}

async function createIssue(
  fp: string,
  e: CentralError,
  now: Date,
  previousIssue?: number,
): Promise<Outcome> {
  if (!(await takeIssueBudget(now, MAX_ISSUES_PER_HOUR))) {
    logger.warn('limite de issues por hora atingido', { fingerprint: fp });
    return 'rate-limited';
  }
  const issue = await github.createIssue(
    issueTitle(e),
    issueBody(e, { fingerprint: fp, previousIssue }),
    issueLabels(e),
  );
  await linkIssue(fp, issue.number, now.toISOString());
  logger.info('issue criada', { fingerprint: fp, issue: issue.number });
  return previousIssue ? 'reopened-as-new' : 'created';
}

export async function processFingerprint(
  fp: string,
  events: CentralError[],
  now = new Date(),
): Promise<Outcome> {
  const last = events[events.length - 1]!;
  const rec: FingerprintRecord = await recordOccurrences(fp, events.length, last.timestamp);
  const nowSec = Math.floor(now.getTime() / 1000);

  if (rec.issueNumber === undefined) {
    if (!(await acquireCreateLock(fp, nowSec))) return 'locked';
    try {
      const outcome = await createIssue(fp, events[0]!, now);
      if (outcome === 'rate-limited') await releaseLock(fp);
      return outcome;
    } catch (err) {
      await releaseLock(fp);
      throw err;
    }
  }

  const lastComment = rec.lastCommentAt ? Date.parse(rec.lastCommentAt) : 0;
  if (rec.pending <= 0 || now.getTime() - lastComment < COMMENT_INTERVAL_MS) return 'skipped';

  const count = await claimComment(rec, now.toISOString());
  if (count === null) return 'skipped';

  const issue = await github.getIssue(rec.issueNumber);
  if (issue.state === 'closed') return createIssue(fp, last, now, rec.issueNumber);
  await github.comment(rec.issueNumber, recurrenceComment(count, last));
  return 'commented';
}

export const handler = withHandler(logger, async (event: CloudWatchLogsEvent, _ctx: Context) => {
  const data = decodeLogsEvent(event);
  if (data.messageType !== 'DATA_MESSAGE') return {};

  const groups = new Map<string, CentralError[]>();
  for (const ev of data.logEvents) {
    const e = parse(ev.message);
    if (!e) continue;
    const fp = fingerprint(e);
    groups.set(fp, [...(groups.get(fp) ?? []), e]);
  }

  const results: Record<string, Outcome | 'failed'> = {};
  for (const [fp, events] of groups) {
    try {
      results[fp] = await processFingerprint(fp, events);
    } catch (err) {
      // Não relança: o reprocessamento duplicaria contagens. Fica no log + alarme.
      logger.error('falha ao processar fingerprint', err, { fingerprint: fp });
      results[fp] = 'failed';
    }
  }
  logger.info('lote processado', redact({ results }) as Record<string, unknown>);
  return results;
});
