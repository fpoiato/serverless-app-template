import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CONFIG_PATH = path.join(ROOT, 'project.config.json');

export interface Config {
  $schema?: string;
  slug: string;
  displayName: string;
  description?: string;
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
  locale?: string;
  currency?: string;
  timeZone?: string;
}

export const readConfig = (): Config => JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Config;
export const writeConfig = (c: Config) =>
  writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2) + '\n');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};
const out = (s: string): void => {
  process.stdout.write(s);
};
export const log = {
  step: (m: string) => out(`\n${C.bold}▶ ${m}${C.reset}\n`),
  ok: (m: string) => out(`  ${C.green}✓${C.reset} ${m}\n`),
  skip: (m: string) => out(`  ${C.dim}• ${m} (já feito)${C.reset}\n`),
  warn: (m: string) => out(`  ${C.yellow}! ${m}${C.reset}\n`),
  fail: (m: string) => out(`  ${C.red}✗ ${m}${C.reset}\n`),
  info: (m: string) => out(`    ${m}\n`),
};

/** Executa e devolve stdout (trim). Lança em código != 0. */
export function sh(
  cmd: string,
  args: string[],
  opts: { input?: string; cwd?: string } = {},
): string {
  return execFileSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    input: opts.input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

/** Igual a sh, mas devolve null em erro (para checagens). */
export function tryShell(
  cmd: string,
  args: string[],
  opts: { input?: string; cwd?: string } = {},
): string | null {
  try {
    return sh(cmd, args, opts);
  } catch {
    return null;
  }
}

/** Executa mostrando a saída ao vivo (deploys longos). */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): void {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...opts.env },
    shell: false,
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} terminou com código ${r.status}`);
}

export const gh = (...args: string[]) => sh('gh', args);
export const ghJson = <T>(...args: string[]): T => JSON.parse(gh(...args)) as T;
export const aws = (...args: string[]) => sh('aws', [...args, '--output', 'json']);
export const awsJson = <T>(...args: string[]): T => JSON.parse(aws(...args) || 'null') as T;
export const tryAwsJson = <T>(...args: string[]): T | null => {
  const out = tryShell('aws', [...args, '--output', 'json']);
  return out === null ? null : (JSON.parse(out || 'null') as T);
};

export class Pending {
  readonly items: string[] = [];
  add(m: string) {
    this.items.push(m);
    log.warn(m);
  }
}
