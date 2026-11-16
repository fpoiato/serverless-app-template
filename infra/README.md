# infra

AWS CDK (TypeScript). Conta `986873053420`, região `us-east-1`.

## Stacks

| Stack                | Issue | O que contém                                                         |
| -------------------- | ----- | -------------------------------------------------------------------- |
| `<slug>-github-oidc` | #3    | Roles `<slug>-gha-deploy` e `<slug>-gha-readonly` assumidas via OIDC |

## Pré-requisitos já existentes na conta (não gerenciados aqui)

- CDK bootstrap (`CDKToolkit`, qualifier `hnb659fds`)
- OIDC provider `token.actions.githubusercontent.com` (compartilhado com outros projetos)

## GitHub Actions

- `<slug>-gha-deploy`: só pode ser assumida por jobs nos environments `prod-deploy` e `prod-swap`.
- `<slug>-gha-readonly`: só por jobs de `pull_request` (para `cdk diff`).
- Teste: rodar o workflow `aws-oidc-check` manualmente.

## Deploy manual (bootstrap das roles)

```bash
npx cdk deploy <slug>-github-oidc
```

## Hosts

Definidos em `lib/config.ts` (`HOSTS`), todos cobertos pelo certificado:

| Host                                | Uso                                         |
| ----------------------------------- | ------------------------------------------- |
| `<domínio>`                         | frontend, cor ativa                         |
| `blue.` / `green.`                  | frontend por cor (smoke test antes do swap) |
| `api.` / `api-blue.` / `api-green.` | API REST ativa e por cor                    |
| `ws.` / `ws-blue.` / `ws-green.`    | WebSocket ativo e por cor                   |
| `media.`                            | mídia (reservado)                           |

Registros DNS são criados pelas stacks que os usam (#5, #6), apenas sob `*.<domínio>`.

## Cor ativa e deploy manual do backend

A cor ativa fica no SSM em `/<slug>/active-color` (criado manualmente uma vez, valor inicial `blue`).
O CDK a recebe por contexto. O script `npm run deploy:backend -w infra` lê o parâmetro e faz o deploy.
Ver [ADR 0001](../docs/adr/0001-blue-green-backend.md).

## Erros centralizados (`/<slug>/errors`)

- Toda `AppFunction` tem uma subscription filter (`<slug>-errors`) com filtro grosso
  (`ERROR`, `Task timed out`, `Runtime exited`, `Runtime.OutOfMemory`) → `<slug>-error-forwarder`.
- O forwarder grava no `/<slug>/errors` **somente** erros reais: linhas JSON `level=ERROR` e falhas de
  plataforma (timeout, memória, init). "Invoke Error" é descartado (o wrapper já registra a exceção).
- Formato: `CentralError` em `backend/src/lib/central-error.ts`.
- Alarmes: `<slug>-central-errors-high` (> 20 erros em 5 min) e `<slug>-error-forwarder-failing`.
- O próprio forwarder não é assinado, para não haver recursão.

## Swap blue/green

```bash
npm run swap -w infra -- green   # ou blue
```

Move frontend, API e WebSocket para a cor informada. Ver [ADR 0002](../docs/adr/0002-blue-green-frontend.md).

## Deploy automático e rollback

- `.github/workflows/deploy.yml` (push na `main`): `infra/scripts/deploy.sh` faz deploy **somente na cor inativa**
  (versão + alias das Lambdas, implantação das stages inativas, sync do bucket e invalidação),
  depois roda o smoke (`frontend/e2e/smoke.spec.ts`) em `<cor>.<domínio>` / `api-<cor>.<domínio>`.
  O job `swap` usa o environment `prod-swap` (aprovação manual) e chama `swap.sh`.
- `.github/workflows/rollback.yml` (manual): swap reverso para a cor anterior, também com aprovação.
- No primeiro deploy, a cor ativa ainda aponta os aliases para `$LATEST`; o script a fixa numa versão antes do `cdk deploy`.
