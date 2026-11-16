import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closingIssues, issueFromBranch, validate } from './issue-link.mjs';

const open = { state: 'open' };

test('extrai a issue da branch', () => {
  assert.equal(issueFromBranch('feat/18-crud-modelos'), 18);
  assert.equal(issueFromBranch('task/1-bootstrap-monorepo'), 1);
  assert.equal(issueFromBranch('main'), null);
  assert.equal(issueFromBranch('feature/18-x'), null);
  assert.equal(issueFromBranch('feat/18'), null);
});

test('encontra referências de fechamento', () => {
  assert.deepEqual(closingIssues('Closes #12\n\nfixes #3'), [12, 3]);
  assert.deepEqual(closingIssues('ver #12'), []);
});

test('PR válido não tem problemas', () => {
  assert.deepEqual(validate({ branch: 'fix/7-x', body: 'Closes #7', issue: open }), []);
});

test('rejeita branch fora do padrão', () => {
  assert.equal(validate({ branch: 'minha-branch', body: 'Closes #7', issue: open }).length, 1);
});

test('rejeita PR sem Closes ou com issue diferente', () => {
  assert.equal(validate({ branch: 'feat/7-x', body: '', issue: open }).length, 1);
  assert.equal(validate({ branch: 'feat/7-x', body: 'Closes #8', issue: open }).length, 1);
  assert.equal(
    validate({ branch: 'feat/7-x', body: 'Closes #7 Closes #8', issue: open }).length,
    1,
  );
});

test('rejeita issue inexistente, fechada ou que é PR', () => {
  assert.equal(validate({ branch: 'feat/7-x', body: 'Closes #7', issue: null }).length, 1);
  assert.equal(
    validate({ branch: 'feat/7-x', body: 'Closes #7', issue: { state: 'closed' } }).length,
    1,
  );
  assert.equal(
    validate({ branch: 'feat/7-x', body: 'Closes #7', issue: { state: 'open', pull_request: {} } })
      .length,
    1,
  );
});
