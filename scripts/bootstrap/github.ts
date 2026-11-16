import { writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { type Config, Pending, ROOT, gh, ghJson, log, sh, tryShell } from './lib.js';

export const STATUS_COLUMNS = [
  ['Triage', 'PURPLE', 'Issues automáticas (erros) aguardando triagem humana'],
  ['Backlog', 'GRAY', 'Planejado, ainda não liberado para execução'],
  ['Todo', 'BLUE', 'Liberado: label status:todo dispara o Claude executor'],
  ['In Progress', 'YELLOW', 'Claude executando'],
  ['Review', 'ORANGE', 'PR aberto, em revisão automática'],
  ['Rework', 'RED', 'Reprovado na revisão, volta para execução'],
  ['Needs Human', 'PINK', 'Limite de ciclos atingido ou bloqueio'],
  ['Done', 'GREEN', 'Merge feito'],
] as const;

export const LABELS: [string, string, string][] = [
  ['status:triage', '8250df', 'Aguardando triagem humana (erros automáticos)'],
  ['status:backlog', 'd0d7de', 'Planejado, não liberado'],
  ['status:todo', '0969da', 'Liberado: dispara o Claude executor'],
  ['status:in-progress', 'bf8700', 'Claude executando'],
  ['status:review', 'fb8f44', 'PR aberto, em revisão automática'],
  ['status:rework', 'cf222e', 'Reprovado na revisão'],
  ['status:needs-human', 'bf3989', 'Limite de ciclos atingido ou bloqueio'],
  ['type:feature', '1f883d', 'Funcionalidade nova'],
  ['type:task', '6e7781', 'Tarefa técnica / infraestrutura'],
  ['type:bug', 'd73a4a', 'Bug reportado manualmente'],
  ['type:error-backend', 'b60205', 'Erro capturado automaticamente no backend'],
  ['type:error-frontend', 'e99695', 'Erro capturado automaticamente no frontend'],
  ['area:infra', '5319e7', 'CDK, AWS, DNS, certificados'],
  ['area:ci', '1d76db', 'GitHub Actions, automação Claude'],
  ['area:observability', '0e8a16', 'Logs, erros, alertas'],
  ['area:backend', '006b75', 'Lambdas, API, DynamoDB'],
  ['area:frontend', 'c5def5', 'Angular'],
  ['area:auth', 'fbca04', 'Autenticação e autorização'],
  ...[0, 1, 2, 3, 4].map(
    (n) =>
      [`phase:${n}`, ['000000', '333333', '555555', '777777', '999999'][n]!, `Fase ${n}`] as [
        string,
        string,
        string,
      ],
  ),
];

const repoOf = (c: Config) => `${c.github.owner}/${c.github.repo}`;

export function checkGithubAuth(pending: Pending): void {
  log.step('GitHub: autenticação');
  const status = tryShell('gh', ['auth', 'status']) ?? '';
  const scopes = /Token scopes: (.*)/.exec(status)?.[1] ?? '';
  for (const s of ['repo', 'project', 'workflow']) {
    if (!scopes.includes(`'${s}'`))
      pending.add(`token do gh sem escopo '${s}': rode gh auth refresh -s repo,project,workflow`);
  }
  log.ok(`gh autenticado (${gh('api', 'user', '-q', '.login')})`);
}

export function fillGithubIds(c: Config): void {
  log.step('GitHub: repositório');
  const repo = ghJson<{ id: number; owner: { id: number; login: string }; name: string }>(
    'api',
    `repos/${repoOf(c)}`,
  );
  if (c.github.repoId === repo.id && c.github.ownerId === repo.owner.id)
    return log.skip('IDs do repositório');
  c.github.repoId = repo.id;
  c.github.ownerId = repo.owner.id;
  log.ok(
    `IDs do repositório (owner ${repo.owner.id}, repo ${repo.id}) para o subject imutável do OIDC`,
  );
}

export function ensureLabels(c: Config): void {
  log.step('GitHub: labels');
  const existing = new Set(
    ghJson<{ name: string }[]>('label', 'list', '-R', repoOf(c), '-L', '200', '--json', 'name').map(
      (l) => l.name,
    ),
  );
  let created = 0;
  for (const [name, color, desc] of LABELS) {
    if (existing.has(name)) continue;
    gh('label', 'create', name, '-R', repoOf(c), '-c', color, '-d', desc, '--force');
    created++;
  }
  if (created) log.ok(`${created} labels criadas`);
  else log.skip('labels');
}

interface StatusField {
  id: string;
  options: { id: string; name: string }[];
}

export function ensureProject(c: Config): void {
  log.step('GitHub: Project (board)');
  const owner = c.github.owner;
  const list = ghJson<{ projects: { number: number; title: string; id: string }[] }>(
    'project',
    'list',
    '--owner',
    owner,
    '--format',
    'json',
    '-L',
    '100',
  );
  let project = c.github.projectNumber
    ? list.projects.find((p) => p.number === c.github.projectNumber)
    : list.projects.find((p) => p.title === c.displayName);
  if (!project) {
    project = ghJson(
      'project',
      'create',
      '--owner',
      owner,
      '--title',
      c.displayName,
      '--format',
      'json',
    );
    log.ok(`Project criado: #${project!.number}`);
  } else log.skip(`Project #${project.number}`);
  c.github.projectNumber = project!.number;
  tryShell('gh', [
    'project',
    'link',
    String(project!.number),
    '--owner',
    owner,
    '--repo',
    repoOf(c),
  ]);

  const fields = ghJson<{ fields: (StatusField & { name: string })[] }>(
    'project',
    'field-list',
    String(project!.number),
    '--owner',
    owner,
    '--format',
    'json',
  );
  let status: StatusField = fields.fields.find((f) => f.name === 'Status')!;
  const want = STATUS_COLUMNS.map(([n]) => n as string);
  if (status.options.map((o) => o.name).join('|') !== want.join('|')) {
    const options = STATUS_COLUMNS.map(
      ([name, color, description]) =>
        `{name: "${name}", color: ${color}, description: "${description}"}`,
    ).join(', ');
    const res = ghJson<{ data: { updateProjectV2Field: { projectV2Field: StatusField } } }>(
      'api',
      'graphql',
      '-f',
      `query=mutation { updateProjectV2Field(input: { fieldId: "${status.id}", singleSelectOptions: [${options}] }) { projectV2Field { ... on ProjectV2SingleSelectField { id options { id name } } } } }`,
    );
    status = res.data.updateProjectV2Field.projectV2Field;
    log.ok('colunas: ' + want.join(' → '));
  } else log.skip('colunas do board');

  const projectJson = {
    projectId: project!.id,
    statusFieldId: status.id,
    statusOptions: Object.fromEntries(status.options.map((o) => [o.name, o.id])),
  };
  writeFileSync(
    path.join(ROOT, '.github/project.json'),
    JSON.stringify(projectJson, null, 2) + '\n',
  );
}

export function ensureRepoSettings(c: Config): void {
  log.step('GitHub: configurações do repositório');
  const repo = repoOf(c);
  gh(
    'repo',
    'edit',
    repo,
    '--enable-squash-merge',
    '--enable-merge-commit=false',
    '--enable-rebase-merge=false',
    '--delete-branch-on-merge',
  );
  gh(
    'api',
    '-X',
    'PUT',
    `repos/${repo}/actions/permissions/workflow`,
    '-F',
    'can_approve_pull_request_reviews=true',
    '-f',
    'default_workflow_permissions=read',
  );
  log.ok('squash merge, apaga branch no merge, Actions pode aprovar PRs (revisor)');

  const me = ghJson<{ id: number }>('api', 'user');
  const put = (url: string, body: unknown) =>
    sh('gh', ['api', '-X', 'PUT', url, '--input', '-'], { input: JSON.stringify(body) });
  const branchPolicy = { protected_branches: true, custom_branch_policies: false };
  put(`repos/${repo}/environments/prod-deploy`, { deployment_branch_policy: branchPolicy });
  put(`repos/${repo}/environments/prod-swap`, {
    reviewers: [{ type: 'User', id: me.id }],
    prevent_self_review: false,
    deployment_branch_policy: branchPolicy,
  });
  log.ok('environments prod-deploy e prod-swap (swap exige sua aprovação)');
}

export function checkSecrets(c: Config, pending: Pending): void {
  log.step('GitHub: secrets');
  const names = new Set(
    ghJson<{ name: string }[]>('secret', 'list', '-R', repoOf(c), '--json', 'name').map(
      (s) => s.name,
    ),
  );
  const repo = repoOf(c);
  if (names.has('CLAUDE_CODE_OAUTH_TOKEN')) log.skip('CLAUDE_CODE_OAUTH_TOKEN');
  else
    pending.add(
      `secret CLAUDE_CODE_OAUTH_TOKEN ausente: rode "claude setup-token" e depois "gh secret set CLAUDE_CODE_OAUTH_TOKEN -R ${repo}"`,
    );
  if (names.has('PROJECT_TOKEN')) log.skip('PROJECT_TOKEN');
  else
    pending.add(
      `secret PROJECT_TOKEN ausente: classic token só com escopo "project" (github.com/settings/tokens/new), depois "gh secret set PROJECT_TOKEN -R ${repo}"`,
    );
  log.info(
    `Confira também se o app do Claude está instalado no repo: https://github.com/apps/claude`,
  );
}

/** Proteção da main: só depois do commit inicial (o bootstrap faz push direto antes disso). */
export function ensureBranchProtection(c: Config): void {
  log.step('GitHub: proteção da main');
  sh('gh', ['api', '-X', 'PUT', `repos/${repoOf(c)}/branches/main/protection`, '--input', '-'], {
    input: JSON.stringify({
      required_status_checks: { strict: false, contexts: ['checks', 'issue-link'] },
      enforce_admins: false,
      required_pull_request_reviews: {
        required_approving_review_count: 1,
        require_code_owner_reviews: true,
        dismiss_stale_reviews: true,
      },
      restrictions: null,
      allow_force_pushes: false,
      allow_deletions: false,
      required_linear_history: true,
      required_conversation_resolution: true,
    }),
  });
  log.ok('PR obrigatório, checks checks + issue-link, revisão do code owner, histórico linear');
}

export function branchIsProtected(c: Config): boolean {
  return tryShell('gh', ['api', `repos/${repoOf(c)}/branches/main/protection`]) !== null;
}

export function enableDeploy(c: Config): void {
  gh('variable', 'set', 'DEPLOY_ENABLED', '-R', repoOf(c), '--body', 'true');
  log.ok('variável DEPLOY_ENABLED=true: todo merge na main faz deploy na cor inativa');
}
