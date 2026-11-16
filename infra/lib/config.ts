import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Configuração do projeto: `project.config.json` na raiz do repositório. Única fonte dos valores do projeto. */
export interface ProjectConfig {
  slug: string;
  displayName: string;
  domain: string;
  hostedZone: { name: string; id: string };
  aws: { account: string; region: string; cdkQualifier?: string };
  github: {
    owner: string;
    repo: string;
    ownerId?: number;
    repoId?: number;
    projectNumber?: number;
  };
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = path.resolve(here, '../../project.config.json');
const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ProjectConfig;

if (!/^[a-z][a-z0-9-]{1,20}$/.test(cfg.slug)) throw new Error(`slug inválido: ${cfg.slug}`);
if (cfg.domain !== cfg.hostedZone.name && !cfg.domain.endsWith(`.${cfg.hostedZone.name}`)) {
  throw new Error(`domain ${cfg.domain} não pertence à zona ${cfg.hostedZone.name}`);
}

export const PROJECT = {
  slug: cfg.slug,
  displayName: cfg.displayName,
  account: cfg.aws.account,
  region: cfg.aws.region,
  repo: `${cfg.github.owner}/${cfg.github.repo}`,
  domain: cfg.domain,
  hostedZoneName: cfg.hostedZone.name,
  hostedZoneId: cfg.hostedZone.id,
  githubOidcProviderArn: `arn:aws:iam::${cfg.aws.account}:oidc-provider/token.actions.githubusercontent.com`,
  cdkQualifier: cfg.aws.cdkQualifier ?? 'hnb659fds',
} as const;

/** Nome de recurso com o prefixo do projeto: `name('web-blue')` → `<slug>-web-blue`. */
export const name = (suffix: string) => `${PROJECT.slug}-${suffix}`;
/** Caminho de parâmetro/log com o prefixo do projeto: `ns('errors')` → `/<slug>/errors`. */
export const ns = (suffix: string) => `/${PROJECT.slug}/${suffix}`;

/**
 * Prefixos aceitos no claim `sub` do OIDC do GitHub. Repositórios com subject imutável usam
 * `repo:<owner>@<ownerId>/<repo>@<repoId>`; o formato antigo fica aceito por compatibilidade.
 */
export const GITHUB_OIDC_SUB_PREFIXES = [
  ...(cfg.github.ownerId && cfg.github.repoId
    ? [`repo:${cfg.github.owner}@${cfg.github.ownerId}/${cfg.github.repo}@${cfg.github.repoId}`]
    : []),
  `repo:${PROJECT.repo}`,
];

export const env = { account: PROJECT.account, region: PROJECT.region };

/** Role assumida pelo GitHub Actions no deploy e no swap (criada pela stack `<slug>-github-oidc`). */
export const DEPLOY_ROLE_NAME = name('gha-deploy');

/** Hosts do projeto. Todos cobertos pelo certificado `<domain>` + `*.<domain>`. */
export const HOSTS = {
  web: PROJECT.domain,
  webBlue: `blue.${PROJECT.domain}`,
  webGreen: `green.${PROJECT.domain}`,
  api: `api.${PROJECT.domain}`,
  apiBlue: `api-blue.${PROJECT.domain}`,
  apiGreen: `api-green.${PROJECT.domain}`,
  ws: `ws.${PROJECT.domain}`,
  wsBlue: `ws-blue.${PROJECT.domain}`,
  wsGreen: `ws-green.${PROJECT.domain}`,
  media: `media.${PROJECT.domain}`,
} as const;
