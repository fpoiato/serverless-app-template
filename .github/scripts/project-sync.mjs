// Regras da sincronização labels `status:*` ↔ coluna Status do Project.
// As labels são a fonte da verdade (disparam os workflows); o board apenas as reflete.

export const STATUS_LABELS = {
  'status:triage': 'Triage',
  'status:backlog': 'Backlog',
  'status:todo': 'Todo',
  'status:in-progress': 'In Progress',
  'status:review': 'Review',
  'status:rework': 'Rework',
  'status:needs-human': 'Needs Human',
};

const names = (labels) => (labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));

/**
 * Quais labels `status:*` remover para sobrar só uma. Se uma label acabou de ser aplicada,
 * ela vence; senão mantém a primeira encontrada.
 */
export function extraStatusLabels(labels, justAdded) {
  const status = names(labels).filter((n) => n in STATUS_LABELS);
  if (status.length <= 1) return [];
  const keep = justAdded && status.includes(justAdded) ? justAdded : status[0];
  return status.filter((n) => n !== keep);
}

/**
 * Coluna do board para uma issue. Fechada → Done. Sem label de status → Backlog
 * (ou Triage, se for issue de erro automática).
 */
export function columnFor(issue, labelsAfterCleanup) {
  if (issue.state === 'closed') return 'Done';
  const ns = names(labelsAfterCleanup ?? issue.labels);
  const status = ns.find((n) => n in STATUS_LABELS);
  if (status) return STATUS_LABELS[status];
  return ns.some((n) => n.startsWith('type:error-')) ? 'Triage' : 'Backlog';
}

/** Label a aplicar quando a issue nasce sem nenhuma `status:*`. */
export function defaultStatusLabel(issue) {
  const ns = names(issue.labels);
  if (ns.some((n) => n in STATUS_LABELS)) return null;
  return ns.some((n) => n.startsWith('type:error-') || n === 'type:bug')
    ? 'status:triage'
    : 'status:backlog';
}
