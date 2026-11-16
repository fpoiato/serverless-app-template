#!/usr/bin/env bash
# Exporta as variáveis do projeto a partir de project.config.json (fonte única).
# Uso: source "$(dirname "$0")/project-env.sh"
_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
_cfg() { node -e "const c=require('$_ROOT/project.config.json');process.stdout.write(String($1))"; }
export PROJECT_ROOT="$_ROOT"
export SLUG="$(_cfg c.slug)"
export DOMAIN="$(_cfg c.domain)"
export ZONE_ID="$(_cfg c.hostedZone.id)"
export AWS_REGION="${AWS_REGION:-$(_cfg c.aws.region)}"
export SSM_PREFIX="/$SLUG"
