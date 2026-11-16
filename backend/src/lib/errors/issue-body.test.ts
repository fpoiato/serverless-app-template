import { describe, expect, it } from 'vitest';
import type { CentralError } from '../central-error.js';
import { issueBody, issueLabels, issueTitle, recurrenceComment } from './issue-body.js';

const e: CentralError = {
  timestamp: '2026-11-16T00:00:00Z',
  source: 'frontend',
  kind: 'exception',
  function: 'fcar-client-errors',
  logGroup: 'g',
  logStream: 's',
  eventId: '1',
  errorName: 'Error',
  message: 'falhou ``` @alguem closes #1',
  stack: 'at x',
  requestId: 'r1',
};

describe('issue', () => {
  it('título e labels por origem, sempre em triage', () => {
    expect(issueTitle(e)).toBe('[erro frontend] Error em fcar-client-errors');
    expect(issueTitle({ ...e, errorName: undefined, source: 'backend' })).toBe(
      '[erro backend] exception em fcar-client-errors',
    );
    expect(issueLabels(e)).toEqual([
      'type:error-frontend',
      'area:frontend',
      'area:observability',
      'status:triage',
    ]);
    expect(issueLabels({ ...e, source: 'backend' })[0]).toBe('type:error-backend');
  });

  it('corpo traz aviso, análise, evidência neutralizada e fingerprint', () => {
    const body = issueBody(e, { fingerprint: 'abc' });
    expect(body).toContain('dado não confiável');
    expect(body).toContain('## Análise\nAnálise automática em andamento (Claude).');
    expect(body).toContain('<!-- analysis:pending -->');
    expect(body).toContain('<!-- error-fingerprint:abc -->');
    expect(body.match(/```/g)).toHaveLength(2); // só a cerca do bloco de evidência
    expect(body).not.toMatch(/@alguem|closes #1/);
  });

  it('tabela de evidência não tem linhas vazias nem pipes soltos', () => {
    const body = issueBody({ ...e, color: undefined, requestId: 'a|b' }, { fingerprint: 'f' });
    const table = body.slice(body.indexOf('| Campo |'), body.indexOf('```text')).trim().split('\n');
    expect(table.every((l) => l.startsWith('|'))).toBe(true);
    expect(body).toContain('a\\|b');
  });

  it('recorrência referencia a issue anterior', () => {
    expect(issueBody(e, { fingerprint: 'f', previousIssue: 7 })).toContain('Recorrência de #7');
  });

  it('comentário de recorrência', () => {
    expect(recurrenceComment(5, e)).toContain('**5**');
  });
});
