/**
 * Bootstrap de um projeto criado a partir do serverless-app-template.
 *
 *   npm run bootstrap -- --name "Meu App" --domain app.exemplo.com --zone exemplo.com \
 *     [--slug meuapp] [--description "..."] [--region us-east-1] [--skip-aws] [--skip-deploy]
 *     [--only github|aws|finalize]
 *
 * Idempotente: pode ser rodado de novo e continua de onde parou. Pré-requisitos: node 22, gh (logado com
 * escopos repo, project, workflow), aws CLI com credenciais de admin da conta, bash.
 */
import { parseArgs } from 'node:util';
import { renderIdentity, refreshReadme } from './identity.js';
import * as aws from './aws.js';
import * as github from './github.js';
import {
  type Config,
  Pending,
  ghJson,
  log,
  readConfig,
  run,
  sh,
  tryShell,
  writeConfig,
} from './lib.js';

const { values: args } = parseArgs({
  options: {
    name: { type: 'string' },
    slug: { type: 'string' },
    domain: { type: 'string' },
    zone: { type: 'string' },
    description: { type: 'string' },
    region: { type: 'string' },
    'skip-aws': { type: 'boolean', default: false },
    /** Roda só uma fase: github (repo, labels, board), aws (infra e primeiro deploy) ou finalize (commit, proteção). */
    only: { type: 'string' },
    'skip-deploy': { type: 'boolean', default: false },
  },
});

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);

function applyArgs(c: Config, useGh: boolean): void {
  if (args.name) c.displayName = args.name;
  if (args.slug) c.slug = args.slug;
  else if (args.name && c.slug === 'meuapp') c.slug = slugify(args.name);
  if (args.domain) c.domain = args.domain;
  if (args.zone)
    c.hostedZone = { name: args.zone, id: c.hostedZone.name === args.zone ? c.hostedZone.id : '' };
  if (args.description) c.description = args.description;
  if (args.region) c.aws.region = args.region;

  // O repositório vem do remote do git (via gh). Nas fases que não usam o GitHub, vale o que já está no config.
  if (useGh) {
    const repo = ghJson<{ owner: { login: string }; name: string }>(
      'repo',
      'view',
      '--json',
      'owner,name',
    );
    c.github.owner = repo.owner.login;
    c.github.repo = repo.name;
  } else if (c.github.owner === 'OWNER') {
    throw new Error('rode antes a fase do GitHub (sem --only, ou --only github)');
  }

  const problems: string[] = [];
  if (c.domain.endsWith('example.com')) problems.push('informe o domínio (--domain)');
  if (c.hostedZone.name === 'example.com') problems.push('informe a zona DNS (--zone)');
  if (c.displayName === 'Meu App' && !args.name) problems.push('informe o nome (--name)');
  if (!/^[a-z][a-z0-9-]{1,20}$/.test(c.slug))
    problems.push(`slug inválido: "${c.slug}" (use --slug)`);
  if (problems.length) {
    throw new Error(
      `project.config.json ainda tem valores de exemplo:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

function commitAndPush(c: Config): void {
  log.step('Git: commit inicial do projeto');
  sh('git', ['add', '-A']);
  if (!tryShell('git', ['diff', '--cached', '--name-only'])) return log.skip('nada a commitar');
  sh('git', ['commit', '-m', `chore: bootstrap do projeto ${c.displayName}`]);
  if (github.branchIsProtected(c)) {
    log.warn(
      'a main já está protegida: abra um PR com este commit (git push origin HEAD:bootstrap-config)',
    );
    return;
  }
  sh('git', ['push', 'origin', 'HEAD:main']);
  log.ok('commit enviado para a main');
}

async function main(): Promise<void> {
  const pending = new Pending();
  const only = args.only;
  if (only && !['github', 'aws', 'finalize'].includes(only))
    throw new Error('--only aceita github, aws ou finalize');
  const phase = (p: string) => !only || only === p;
  const c = readConfig();
  applyArgs(c, only !== 'aws');
  log.step(`Projeto ${c.displayName} (${c.slug}) → https://${c.domain}`);

  if (phase('github')) {
    github.checkGithubAuth(pending);
    github.fillGithubIds(c);
    renderIdentity(c);
    writeConfig(c);
    github.ensureLabels(c);
    github.ensureProject(c);
    refreshReadme(c);
    github.ensureRepoSettings(c);
    github.checkSecrets(c, pending);
    writeConfig(c);
  }

  let deployed = only === 'finalize';
  if (phase('aws')) {
    if (!args['skip-aws']) {
      aws.checkAwsIdentity(c);
      aws.resolveZone(c);
      writeConfig(c);
      aws.ensureCdkBootstrap(c);
      aws.ensureOidcProvider(c);
      const active = aws.ensureActiveColor(c);
      aws.checkIssuesSecret(c, pending);
      run('npm', ['ci']);
      aws.deployInfra(c, active);
      if (!args['skip-deploy']) {
        aws.firstAppDeploy(c);
        deployed = true;
      }
    } else
      pending.add(
        'etapas da AWS puladas (--skip-aws): rode de novo sem a flag quando tiver credenciais',
      );
    writeConfig(c);
  }

  if (phase('finalize')) {
    commitAndPush(c);
    github.ensureBranchProtection(c);
    if (deployed) github.enableDeploy(c);
  }

  log.step('Resumo');
  log.info(`Site:  https://${c.domain}`);
  log.info(`API:   https://api.${c.domain}/health`);
  log.info(
    `Board: https://github.com/users/${c.github.owner}/projects/${c.github.projectNumber ?? ''}`,
  );
  if (pending.items.length) {
    process.stdout.write('\nPendências (faça e rode o bootstrap de novo para conferir):\n');
    pending.items.forEach((p, i) => process.stdout.write(`  ${i + 1}. ${p}\n`));
    process.exitCode = 2;
  } else if (!only || only === 'finalize') {
    process.stdout.write('\nTudo pronto. Crie a primeira issue e aplique status:todo.\n');
  }
}

main().catch((err: unknown) => {
  log.fail(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
