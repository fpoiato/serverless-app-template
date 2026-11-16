#!/usr/bin/env node
// Gera o /config.json do frontend para uma cor.
// Uso: aws ssm get-parameters-by-path --path /<slug>/public --recursive --output json \
//        | node infra/scripts/web-config.mjs <cor> <versão> > dist/config.json
// O mapa `public` recebe todo parâmetro SSM em /<slug>/public/... (ex.: auth/user-pool-id).
import { readFileSync } from 'node:fs';

const [color, version] = process.argv.slice(2);
if (color !== 'blue' && color !== 'green') {
  process.stderr.write('uso: web-config.mjs <blue|green> <versão>\n');
  process.exit(2);
}
const project = JSON.parse(
  readFileSync(new URL('../../project.config.json', import.meta.url), 'utf8'),
);
const stdin = readFileSync(0, 'utf8').trim();
const params = stdin ? (JSON.parse(stdin).Parameters ?? []) : [];
const prefix = `/${project.slug}/public/`;

const config = {
  color,
  version: version || 'dev',
  apiUrl: `https://api-${color}.${project.domain}`,
  wsUrl: `wss://ws-${color}.${project.domain}`,
  public: Object.fromEntries(
    params
      .filter((p) => p.Name.startsWith(prefix))
      .map((p) => [p.Name.slice(prefix.length), p.Value])
      .sort(([a], [b]) => a.localeCompare(b)),
  ),
};
process.stdout.write(JSON.stringify(config, null, 2) + '\n');
