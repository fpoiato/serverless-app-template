# 0001 — Blue/green do backend com aliases de Lambda e stage variables

## Contexto

Produção deve alternar entre duas versões completas (blue e green), com troca rápida e
rollback trivial. O DynamoDB é compartilhado pelas duas cores.

## Decisão

- **Lambda:** cada função (`AppFunction`) tem os aliases `blue` e `green`. O CloudFormation
  os cria apontando para `$LATEST` e nunca mais os altera, porque o valor no template é constante.
  O deploy (#15) publica uma versão nova e move **só o alias da cor inativa**.
- **API REST e WebSocket:** uma API de cada, com as stages `blue` e `green`. A stage variable
  `color` escolhe o alias (`function:<slug>-x:${stageVariables.color}`).
- **Implantações das stages:** o CDK cria uma implantação inicial com ID lógico fixo, de modo que
  `cdk deploy` nunca altera as stages. O workflow de deploy cria uma implantação nova
  **apenas na stage inativa** (`aws apigateway create-deployment --stage-name <inativa>`).
- **Domínios:**
  - `api-blue.`/`api-green.` e `ws-blue.`/`ws-green.` ficam sempre fixos na sua cor (usados em smoke tests).
  - `api.` e `ws.` apontam para a cor ativa via base path mapping / API mapping. A cor ativa vem
    do parâmetro SSM `/<slug>/active-color`, passado ao CDK por `-c app:activeColor=...`.
  - O swap atualiza o parâmetro e esses mapeamentos.
- **DynamoDB:** compartilhado. Toda mudança precisa ser retrocompatível (ver `CLAUDE.md`).

## Consequências

- Até o workflow de deploy existir (#15), os aliases apontam para `$LATEST`: um `cdk deploy`
  manual muda o código das duas cores ao mesmo tempo.
- Rotas novas na API REST só aparecem numa stage depois de uma nova implantação nessa stage
  (feita pelo workflow de deploy). Em deploy manual: `aws apigateway create-deployment
--rest-api-id <id> --stage-name <cor>`.
- O WebSocket responde aos clientes pelo endpoint `execute-api` (`<apiId>.execute-api.<região>.amazonaws.com/<stage>`),
  nunca pelo domínio próprio.
