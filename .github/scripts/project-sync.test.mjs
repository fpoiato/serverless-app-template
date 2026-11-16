import assert from 'node:assert/strict';
import { test } from 'node:test';
import { columnFor, defaultStatusLabel, extraStatusLabels } from './project-sync.mjs';

const L = (...n) => n.map((name) => ({ name }));

test('mantém só a label de status recém-aplicada', () => {
  assert.deepEqual(
    extraStatusLabels(L('type:task', 'status:todo', 'status:backlog'), 'status:todo'),
    ['status:backlog'],
  );
  assert.deepEqual(extraStatusLabels(L('status:review'), 'status:review'), []);
  assert.deepEqual(extraStatusLabels(L('status:review', 'status:todo')), ['status:todo']);
});

test('coluna segue a label de status', () => {
  assert.equal(columnFor({ state: 'open', labels: L('status:in-progress') }), 'In Progress');
  assert.equal(columnFor({ state: 'open', labels: L('status:needs-human') }), 'Needs Human');
  assert.equal(columnFor({ state: 'open', labels: L('status:rework', 'area:ci') }), 'Rework');
});

test('fechada vai para Done', () => {
  assert.equal(columnFor({ state: 'closed', labels: L('status:review') }), 'Done');
});

test('sem label de status: erro automático em Triage, resto em Backlog', () => {
  assert.equal(columnFor({ state: 'open', labels: L('type:error-backend') }), 'Triage');
  assert.equal(columnFor({ state: 'open', labels: L('type:feature') }), 'Backlog');
});

test('label padrão para issues novas', () => {
  assert.equal(defaultStatusLabel({ labels: L('type:feature') }), 'status:backlog');
  assert.equal(defaultStatusLabel({ labels: L('type:bug') }), 'status:triage');
  assert.equal(defaultStatusLabel({ labels: L('type:error-frontend') }), 'status:triage');
  assert.equal(defaultStatusLabel({ labels: L('status:todo') }), null);
});
