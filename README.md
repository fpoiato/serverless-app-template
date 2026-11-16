<!-- serverless-app-template:readme -->

# serverless-app-template

Template de app serverless na AWS com **fluxo de desenvolvimento conduzido por issues e pelo Claude**.
Do zero até o site no ar, com deploy blue/green, observabilidade e executor/revisor automáticos, com um comando.

## O que vem pronto

| Camada          | O que tem                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend        | Angular 22 (standalone, zoneless, pt-BR), Playwright, captura global de erros do navegador                                                                                                 |
| Backend         | API Gateway REST + WebSocket → Lambda (Node 22, TS, ARM64), DynamoDB single-table                                                                                                          |
| Deploy          | CloudFront + S3 e aliases de Lambda em **blue/green**; merge → cor inativa → smoke → **sua aprovação** → produção; rollback                                                                |
| Observabilidade | log central `/<slug>/errors` (só erros, backend e frontend) → issue no GitHub em _Triage_ com análise do Claude, deduplicação e limite por hora; alarmes; WAF no endpoint público          |
| Fluxo           | issue → `status:todo` → **Claude executor** (plano, código, testes, PR) → **Claude revisor** (até 3 ciclos) → **merge humano**; board sincronizado com as labels; comentários de progresso |
| Segurança       | OIDC (sem access keys), CODEOWNERS, `main` protegida, modelos sem escrita onde leem conteúdo não confiável                                                                                 |

Tudo que é específico do projeto fica em **`project.config.json`**.

## Criar um projeto

Pré-requisitos: Node 22, `bash`, [GitHub CLI](https://cli.github.com) logado
(`gh auth login -s repo,project,workflow`) e AWS CLI com credenciais de administrador da conta.
A zona DNS precisa existir no Route 53 da conta.

```bash
gh repo create meuapp --template fpoiato/serverless-app-template --public --clone
cd meuapp && npm ci
npm run bootstrap -- --name "Meu App" --domain app.exemplo.com --zone exemplo.com \
  --description "O que o app faz"
```

O domínio pode ser a própria zona (`--domain exemplo.com --zone exemplo.com`) ou um subdomínio dela.

O bootstrap é **idempotente**: se parar no meio, corrija e rode de novo. Ele faz:

1. **Configuração:** preenche `project.config.json` (conta AWS, id da zona, IDs do repositório) e os arquivos de identidade (README, CLAUDE.md, LICENSE, CODEOWNERS)
2. **GitHub:** labels, Project com as colunas do fluxo, squash merge, environments `prod-deploy`/`prod-swap`, permissão para o revisor aprovar PRs e proteção da `main`
3. **AWS:** CDK bootstrap, provider OIDC do GitHub, `/<slug>/active-color`, stacks (certificado, frontend, backend, roles de deploy)
4. **Primeiro deploy** nas duas cores, com o site no ar
5. Commit inicial e `DEPLOY_ENABLED=true`, a partir de quando todo merge faz deploy

Para rodar uma fase só, use `--only github` (repo, labels, board), `--only aws` (infra e primeiro deploy;
não precisa do `gh`) ou `--only finalize` (commit inicial, proteção da `main`, `DEPLOY_ENABLED`). Útil quando o
login do GitHub e as credenciais da AWS estão em máquinas diferentes, ou para repetir só a parte que falhou.

### O que só você pode fazer

O bootstrap confere e lista o que faltar:

| Item                         | Como                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| App do Claude no repositório | https://github.com/apps/claude                                                                                              |
| `CLAUDE_CODE_OAUTH_TOKEN`    | `claude setup-token`, depois `gh secret set CLAUDE_CODE_OAUTH_TOKEN`                                                        |
| `PROJECT_TOKEN`              | classic token **só** com escopo `project` → `gh secret set PROJECT_TOKEN`                                                   |
| Token das issues de erro     | fine-grained, só este repo, _Issues: read/write_ → `aws secretsmanager create-secret --name <slug>/github-issues-token ...` |
| Aprovar o swap               | Actions → deploy → _Review deployments_ → `prod-swap`                                                                       |

## Limites conhecidos

- O executor **não altera** `.github/workflows/`: o token do app do Claude não tem a permissão `workflows`, e isso é desejável.
  Mudanças em workflows são feitas por um humano.
- Mover um card no board **não** dispara nada; quem dispara é a label `status:todo`.
- PRs abertos com o seu usuário precisam do merge com _bypass_ de admin, porque você não pode aprovar o próprio PR.

## Documentação

- [CLAUDE.md](CLAUDE.md): convenções seguidas por humanos e pelo Claude
- [docs/adr](docs/adr): decisões (blue/green do backend e do frontend)
- [docs/observability.md](docs/observability.md): fluxo de erros
- [infra/README.md](infra/README.md): stacks, hosts e deploy

Nascido do projeto [fcar](https://github.com/fpoiato/fcar).
