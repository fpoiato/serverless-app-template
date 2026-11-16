#!/usr/bin/env bash
# Deploy na cor INATIVA (backend + frontend). Nunca toca na cor ativa.
# Uso: infra/scripts/deploy.sh [versão]   (versão padrão: git sha curto)
# Saída: grava `inactive=<cor>` e `active=<cor>` em $GITHUB_OUTPUT, se definido.
# Ver docs/adr/0001-blue-green-backend.md e 0002-blue-green-frontend.md
set -euo pipefail

source "$(dirname "$0")/project-env.sh"
ROOT="$PROJECT_ROOT"
VERSION="${1:-$(git -C "$ROOT" rev-parse --short HEAD)}"

ACTIVE=$(aws ssm get-parameter --name "$SSM_PREFIX/active-color" --query Parameter.Value --output text)
case "$ACTIVE" in
  blue) INACTIVE=green ;;
  green) INACTIVE=blue ;;
  *) echo "$SSM_PREFIX/active-color inválido: $ACTIVE" >&2; exit 1 ;;
esac
echo "Cor ativa: $ACTIVE | deploy em: $INACTIVE | versão: $VERSION"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  { echo "active=$ACTIVE"; echo "inactive=$INACTIVE"; } >>"$GITHUB_OUTPUT"
fi

# -1. Stacks de base primeiro: a role de deploy (<slug>-github-oidc) recebe aqui as permissões que os
#     passos seguintes usam. O próprio CloudFormation roda com a role de execução do CDK.
(cd "$ROOT/infra" && npx cdk deploy "$SLUG-github-oidc" "$SLUG-dns-certs" \
  -c "app:activeColor=$ACTIVE" --require-approval never)
sleep 10 # propagação do IAM

FUNCTIONS=$(aws lambda list-functions --query "Functions[?starts_with(FunctionName,'$SLUG-')].FunctionName" --output text)

# 0. Proteção da cor ativa: enquanto o alias ainda aponta para $LATEST (estado inicial do CDK),
#    o `cdk deploy` abaixo mudaria o código de produção. Fixa a cor ativa na versão atual antes.
for fn in $FUNCTIONS; do
  current=$(aws lambda get-alias --function-name "$fn" --name "$ACTIVE" --query FunctionVersion --output text 2>/dev/null || true)
  if [[ "$current" == '$LATEST' ]]; then
    pinned=$(aws lambda publish-version --function-name "$fn" --description "pin $ACTIVE antes de $VERSION" --query Version --output text)
    aws lambda update-alias --function-name "$fn" --name "$ACTIVE" --function-version "$pinned" >/dev/null
    echo "  pin: $fn:$ACTIVE -> v$pinned"
  fi
done

# 1. Infra + código ($LATEST). Os aliases são constantes no template, então nada muda em produção.
(cd "$ROOT/infra" && npx cdk deploy "$SLUG-backend" "$SLUG-frontend" \
  -c "app:activeColor=$ACTIVE" -c "app:appVersion=$VERSION" --require-approval never)

# 2. Backend: publica uma versão por Lambda e move só o alias da cor inativa.
for fn in $FUNCTIONS; do
  aws lambda get-alias --function-name "$fn" --name "$INACTIVE" >/dev/null 2>&1 || continue
  ver=$(aws lambda publish-version --function-name "$fn" --description "$VERSION" --query Version --output text)
  aws lambda update-alias --function-name "$fn" --name "$INACTIVE" --function-version "$ver" >/dev/null
  echo "  lambda: $fn:$INACTIVE -> v$ver"
done

# 3. API Gateway: nova implantação apenas na stage inativa (REST e WebSocket).
stack_output() {
  aws cloudformation describe-stacks --stack-name "$SLUG-backend" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
aws apigateway create-deployment --rest-api-id "$(stack_output RestApiId)" \
  --stage-name "$INACTIVE" --description "$VERSION" >/dev/null
aws apigatewayv2 create-deployment --api-id "$(stack_output WsApiId)" \
  --stage-name "$INACTIVE" --description "$VERSION" >/dev/null
echo "  api: stages $INACTIVE implantadas"

# 4. Frontend: um único build (sem valores de ambiente) + /config.json da cor, gerado do SSM.
(cd "$ROOT/frontend" && npx ng build)
BUCKET=$(aws ssm get-parameter --name "$SSM_PREFIX/web/$INACTIVE/bucket" --query Parameter.Value --output text)
DIST=$(aws ssm get-parameter --name "$SSM_PREFIX/web/$INACTIVE/distribution-id" --query Parameter.Value --output text)
DIST_DIR="$ROOT/frontend/dist/web/browser"
[[ -d "$DIST_DIR" ]] || { echo "build não encontrado em $DIST_DIR" >&2; exit 1; }
aws ssm get-parameters-by-path --path "$SSM_PREFIX/public" --recursive --output json \
  | node "$ROOT/infra/scripts/web-config.mjs" "$INACTIVE" "$VERSION" > "$DIST_DIR/config.json"
echo "  config.json: $(tr -d '\n ' < "$DIST_DIR/config.json")"
# Assets com hash: cache longo. index.html e config.json: sem cache.
aws s3 sync "$DIST_DIR" "s3://$BUCKET" --delete --exclude index.html --exclude config.json \
  --cache-control "public,max-age=31536000,immutable"
aws s3 cp "$DIST_DIR/config.json" "s3://$BUCKET/config.json" \
  --cache-control "no-cache" --content-type "application/json"
aws s3 cp "$DIST_DIR/index.html" "s3://$BUCKET/index.html" \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths '/*' >/dev/null
echo "Deploy concluído em $INACTIVE (https://$INACTIVE.$DOMAIN)."
