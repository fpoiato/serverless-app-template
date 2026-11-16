import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { type Config, ROOT, log } from './lib.js';

const TEMPLATE_README_MARKER = '<!-- serverless-app-template:readme -->';

function replaceIn(file: string, pairs: [string | RegExp, string][]): boolean {
  const p = path.join(ROOT, file);
  if (!existsSync(p)) return false;
  const before = readFileSync(p, 'utf8');
  let after = before;
  for (const [a, b] of pairs) after = after.replaceAll(a as string, b);
  if (after !== before) writeFileSync(p, after);
  return after !== before;
}

function projectReadme(c: Config): string {
  return `# ${c.displayName}

${c.description ?? ''} — [${c.domain}](https://${c.domain})

- Arquitetura, convenções e fluxo de trabalho: [CLAUDE.md](CLAUDE.md)
- Board: [Project](https://github.com/users/${c.github.owner}/projects/${c.github.projectNumber ?? ''})
- Criado a partir de [serverless-app-template](https://github.com/fpoiato/serverless-app-template)

## Começando

\`\`\`bash
nvm use        # Node 22
npm ci
npm run lint && npm run typecheck && npm test
\`\`\`

## Fluxo

1. Crie a issue (templates em *New issue*) e aplique a label \`status:todo\`.
2. O executor (Claude) implementa e abre o PR; o revisor (Claude) aprova ou devolve.
3. Você faz o merge. O deploy vai para a cor inativa e espera sua aprovação em \`prod-swap\`.
`;
}

/** Preenche os arquivos de identidade do projeto (só onde ainda há marcadores do template). */
export function renderIdentity(c: Config): void {
  log.step('Identidade do projeto');
  const changed: string[] = [];
  const add = (file: string, ok: boolean) => ok && changed.push(file);

  add(
    'CLAUDE.md',
    replaceIn('CLAUDE.md', [
      ['{{PROJECT_NAME}}', c.displayName],
      ['{{DESCRIPTION}}', c.description ?? c.displayName],
      ['{{DOMAIN}}', c.domain],
    ]),
  );
  add('LICENSE', replaceIn('LICENSE', [['OWNER', c.github.owner]]));
  add('.github/CODEOWNERS', replaceIn('.github/CODEOWNERS', [['@OWNER', `@${c.github.owner}`]]));
  add(
    'frontend/src/index.html',
    replaceIn('frontend/src/index.html', [
      ['<title>app</title>', `<title>${c.displayName}</title>`],
    ]),
  );

  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string; description: string };
  if (pkg.name !== c.slug) {
    pkg.name = c.slug;
    pkg.description = `${c.description ?? c.displayName} — ${c.domain}`;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    changed.push('package.json');
  }

  const readmePath = path.join(ROOT, 'README.md');
  if (readFileSync(readmePath, 'utf8').includes(TEMPLATE_README_MARKER)) {
    writeFileSync(readmePath, projectReadme(c));
    changed.push('README.md');
  }

  if (changed.length) log.ok(`atualizados: ${changed.join(', ')}`);
  else log.skip('arquivos de identidade');
}

/** README do projeto depende do número do Project; reescreve se ainda estiver sem ele. */
export function refreshReadme(c: Config): void {
  const readmePath = path.join(ROOT, 'README.md');
  const s = readFileSync(readmePath, 'utf8');
  if (s.includes('/projects/)') && c.github.projectNumber) {
    writeFileSync(readmePath, s.replace('/projects/)', `/projects/${c.github.projectNumber})`));
  }
}
