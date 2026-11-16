// Regras de vínculo PR ↔ issue. Funções puras, testadas em issue-link.test.mjs.

export const BRANCH_PATTERN = /^(feat|fix|task|error|docs)\/(\d+)-[a-z0-9][a-z0-9-]*$/;

/** Extrai o número da issue do nome da branch, ou null se fora do padrão. */
export function issueFromBranch(branch) {
  const m = BRANCH_PATTERN.exec(branch ?? '');
  return m ? Number(m[2]) : null;
}

/** Números citados com Closes/Fixes/Resolves #N no corpo do PR. */
export function closingIssues(body) {
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
  return [...(body ?? '').matchAll(re)].map((m) => Number(m[1]));
}

/** Retorna a lista de problemas (vazia = ok). `issue` é o objeto da API ou null. */
export function validate({ branch, body, issue }) {
  const problems = [];
  const fromBranch = issueFromBranch(branch);
  if (fromBranch === null) {
    problems.push(
      `Branch "${branch}" fora do padrão <tipo>/<nº-issue>-<slug> (tipos: feat, fix, task, error, docs).`,
    );
  }
  const closes = closingIssues(body);
  if (closes.length !== 1) {
    problems.push(
      `O corpo do PR deve conter exatamente um "Closes #<nº>" (encontrados: ${closes.length}).`,
    );
  } else if (fromBranch !== null && closes[0] !== fromBranch) {
    problems.push(`"Closes #${closes[0]}" não corresponde à issue da branch (#${fromBranch}).`);
  }
  if (fromBranch !== null) {
    if (!issue) problems.push(`Issue #${fromBranch} não encontrada.`);
    else if (issue.pull_request) problems.push(`#${fromBranch} é um PR, não uma issue.`);
    else if (issue.state !== 'open') problems.push(`Issue #${fromBranch} não está aberta.`);
  }
  return problems;
}
