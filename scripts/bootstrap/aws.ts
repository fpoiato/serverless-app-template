import {
  type Config,
  Pending,
  aws,
  awsJson,
  log,
  run,
  tryAwsJson,
  tryShell,
  writeConfig,
} from './lib.js';

const OIDC_URL = 'token.actions.githubusercontent.com';
// Thumbprints publicados pelo GitHub (a AWS valida o OIDC do GitHub sem depender deles, mas a API exige).
const OIDC_THUMBPRINTS = [
  '6938fd4d98bab03faadb97b34396831e3780aea1',
  '1c58a3a8518e8759bf075b76b750d4f2df264fcd',
];

export function checkAwsIdentity(c: Config): void {
  log.step('AWS: credenciais');
  const id = tryAwsJson<{ Account: string; Arn: string }>('sts', 'get-caller-identity');
  if (!id)
    throw new Error(
      'Sem credenciais AWS válidas. Configure (aws configure / aws sso login / variáveis) e rode de novo.',
    );
  if (!/^\d{12}$/.test(c.aws.account) || c.aws.account === '000000000000') {
    c.aws.account = id.Account;
    log.ok(`conta ${id.Account} gravada no project.config.json`);
  } else if (c.aws.account !== id.Account) {
    throw new Error(
      `As credenciais são da conta ${id.Account}, mas o project.config.json diz ${c.aws.account}.`,
    );
  } else log.ok(`conta ${id.Account} (${id.Arn.split('/').slice(-2).join('/')})`);
}

export function resolveZone(c: Config): void {
  log.step('AWS: zona DNS');
  const zones = awsJson<{
    HostedZones: { Id: string; Name: string; Config: { PrivateZone: boolean } }[];
  }>('route53', 'list-hosted-zones-by-name', '--dns-name', c.hostedZone.name).HostedZones.filter(
    (z) => z.Name === `${c.hostedZone.name}.` && !z.Config.PrivateZone,
  );
  if (zones.length === 0)
    throw new Error(`Zona pública ${c.hostedZone.name} não encontrada no Route 53 desta conta.`);
  if (zones.length > 1 && !zones.some((z) => z.Id.endsWith(c.hostedZone.id))) {
    throw new Error(
      `Há ${zones.length} zonas ${c.hostedZone.name}; informe o id certo em hostedZone.id.`,
    );
  }
  const zone = zones.find((z) => z.Id.endsWith(c.hostedZone.id)) ?? zones[0]!;
  const id = zone.Id.replace('/hostedzone/', '');
  if (c.hostedZone.id !== id) {
    c.hostedZone.id = id;
    log.ok(`zona ${c.hostedZone.name} → ${id}`);
  } else log.skip(`zona ${c.hostedZone.name} (${id})`);
  if (c.domain !== c.hostedZone.name && !c.domain.endsWith(`.${c.hostedZone.name}`)) {
    throw new Error(`O domínio ${c.domain} não pertence à zona ${c.hostedZone.name}.`);
  }
  // Conflitos: registros já existentes com os nomes que o projeto vai criar.
  const names = new Set(
    ['', 'blue.', 'green.', 'api.', 'api-blue.', 'api-green.', 'ws.', 'ws-blue.', 'ws-green.'].map(
      (p) => `${p}${c.domain}.`,
    ),
  );
  const records = awsJson<{ ResourceRecordSets: { Name: string; Type: string }[] }>(
    'route53',
    'list-resource-record-sets',
    '--hosted-zone-id',
    id,
  ).ResourceRecordSets.filter((r) => names.has(r.Name) && ['A', 'AAAA', 'CNAME'].includes(r.Type));
  const ours = tryAwsJson(
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    `${c.slug}-frontend`,
  );
  if (records.length && !ours) {
    throw new Error(
      `Já existem registros que o projeto precisa criar: ${records.map((r) => `${r.Name} ${r.Type}`).join(', ')}. Remova-os ou escolha outro domínio.`,
    );
  }
}

export function ensureCdkBootstrap(c: Config): void {
  log.step('AWS: CDK bootstrap');
  if (
    tryAwsJson(
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'CDKToolkit',
      '--region',
      c.aws.region,
    )
  ) {
    return log.skip('CDKToolkit');
  }
  run('npx', ['cdk', 'bootstrap', `aws://${c.aws.account}/${c.aws.region}`], { cwd: 'infra' });
  log.ok('CDK bootstrap');
}

export function ensureOidcProvider(c: Config): void {
  log.step('AWS: OIDC do GitHub Actions');
  const arn = `arn:aws:iam::${c.aws.account}:oidc-provider/${OIDC_URL}`;
  if (tryAwsJson('iam', 'get-open-id-connect-provider', '--open-id-connect-provider-arn', arn)) {
    return log.skip('provider token.actions.githubusercontent.com');
  }
  aws(
    'iam',
    'create-open-id-connect-provider',
    '--url',
    `https://${OIDC_URL}`,
    '--client-id-list',
    'sts.amazonaws.com',
    '--thumbprint-list',
    ...OIDC_THUMBPRINTS,
  );
  log.ok('provider OIDC criado');
}

const ssmGet = (c: Config, name: string) =>
  tryAwsJson<{ Parameter: { Value: string } }>(
    'ssm',
    'get-parameter',
    '--name',
    `/${c.slug}/${name}`,
    '--region',
    c.aws.region,
  )?.Parameter.Value ?? null;

export function ensureActiveColor(c: Config): string {
  log.step('AWS: cor ativa');
  const current = ssmGet(c, 'active-color');
  if (current) {
    log.skip(`/${c.slug}/active-color = ${current}`);
    return current;
  }
  aws(
    'ssm',
    'put-parameter',
    '--name',
    `/${c.slug}/active-color`,
    '--type',
    'String',
    '--value',
    'blue',
    '--region',
    c.aws.region,
  );
  log.ok(`/${c.slug}/active-color = blue`);
  return 'blue';
}

export function checkIssuesSecret(c: Config, pending: Pending): void {
  const name = `${c.slug}/github-issues-token`;
  if (
    tryAwsJson('secretsmanager', 'describe-secret', '--secret-id', name, '--region', c.aws.region)
  )
    return log.skip(`secret ${name}`);
  pending.add(
    `secret ${name} ausente no Secrets Manager (erros → issues): crie um fine-grained token só para ${c.github.owner}/${c.github.repo} com "Issues: Read and write" e rode: aws secretsmanager create-secret --region ${c.aws.region} --name ${name} --secret-string 'github_pat_...'`,
  );
}

const cdkDeploy = (c: Config, color: string, stacks: string[]) =>
  run(
    'npx',
    [
      'cdk',
      'deploy',
      ...stacks.map((s) => `${c.slug}-${s}`),
      '-c',
      `app:activeColor=${color}`,
      '--require-approval',
      'never',
    ],
    { cwd: 'infra' },
  );

/** Stacks de infraestrutura. Saídas (IDs, ARNs) ficam no SSM, publicadas pelas próprias stacks. */
export function deployInfra(c: Config, activeColor: string): void {
  log.step('AWS: stacks (pode levar 10–20 min na primeira vez)');
  run('npm', ['run', 'build', '-w', '@app/shared']);
  writeConfig(c); // a infra lê o project.config.json
  cdkDeploy(c, activeColor, ['github-oidc', 'dns-certs', 'frontend', 'backend']);
  log.ok('stacks implantadas');
}

const bucketHasApp = (c: Config, color: string) =>
  tryShell('aws', [
    's3api',
    'head-object',
    '--bucket',
    `${c.slug}-web-${color}`,
    '--key',
    'index.html',
    '--region',
    c.aws.region,
  ]) !== null;

/** Primeiro deploy do app nas duas cores: deploy (inativa) → swap → deploy (a outra). */
export function firstAppDeploy(c: Config): void {
  log.step('Primeiro deploy do app (duas cores)');
  if (bucketHasApp(c, 'blue') && bucketHasApp(c, 'green'))
    return log.skip('app já publicado nas duas cores');
  run('bash', ['infra/scripts/deploy.sh', 'bootstrap']);
  const active = ssmGet(c, 'active-color')!;
  const target = active === 'blue' ? 'green' : 'blue';
  run('bash', ['infra/scripts/swap.sh', target]);
  run('bash', ['infra/scripts/deploy.sh', 'bootstrap']);
  log.ok(`app publicado nas duas cores; produção em ${target}`);
}
