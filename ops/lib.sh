#!/usr/bin/env bash
# Shared helpers for install.sh and ops/*.sh. Never prints a secret.

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() {
  printf '  \033[31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}

# Reads KEY from .env (last value wins).
env_get() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- || true
}

# Sets KEY=VALUE in .env without touching the other lines.
env_set() {
  local key=$1 value=$2 tmp
  tmp=$(mktemp)
  if grep -qE "^$key=" .env; then
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' .env >"$tmp"
  else
    cat .env >"$tmp"
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
  fi
  cat "$tmp" >.env
  rm "$tmp"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker est introuvable : https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 est introuvable (plugin « docker compose »)."
  docker info >/dev/null 2>&1 || die "Docker ne répond pas : démarre-le, ou ajoute ton utilisateur au groupe docker."
}

wait_for_backend() {
  local i
  for i in $(seq 1 60); do
    if [ "$(docker inspect -f '{{.State.Health.Status}}' market-radar-convex 2>/dev/null)" = healthy ]; then
      return 0
    fi
    sleep 2
  done
  die "Convex ne démarre pas : docker compose logs backend"
}

# Pushes convex/ (schema + functions) to the self-hosted backend.
# `convex deploy` runs inside the worker IMAGE, which holds its own copy of
# the code: always rebuild the worker image first.
deploy_functions() {
  local admin_key out
  docker compose build worker >/tmp/market-radar-build.log 2>&1 || {
    tail -n 30 /tmp/market-radar-build.log
    die "La construction de l’image worker a échoué (log : /tmp/market-radar-build.log)."
  }
  admin_key=$(docker exec market-radar-convex /convex/generate_admin_key.sh 2>/dev/null | tail -n 1)
  [ -n "$admin_key" ] || die "Impossible de générer la clé admin Convex."
  out=$(docker compose run --rm --no-deps \
    -e CONVEX_SELF_HOSTED_URL=http://backend:3210 \
    -e CONVEX_SELF_HOSTED_ADMIN_KEY="$admin_key" \
    worker npx convex deploy --yes 2>&1) || true
  if ! printf '%s' "$out" | grep -q "Deployed Convex"; then
    printf '%s\n' "$out" | tail -n 30
    die "Le déploiement des fonctions Convex a échoué."
  fi
  ok "Fonctions Convex déployées"
}

# Local URL to check the web app, whatever BIND_ADDRESS is.
local_app_url() {
  local bind
  bind=$(env_get BIND_ADDRESS)
  case "$bind" in
    "" | 0.0.0.0) echo "http://localhost:3100" ;;
    *) echo "http://$bind:3100" ;;
  esac
}

wait_for_web() {
  local url i
  url=$(local_app_url)
  for i in $(seq 1 60); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  warn "L’application ne répond pas encore sur $url (docker compose logs web)."
}

running_tasks() {
  local bind host
  bind=$(env_get BIND_ADDRESS)
  case "$bind" in "" | 0.0.0.0) host=localhost ;; *) host=$bind ;; esac
  curl -fsS -X POST "http://$host:3210/api/query" -H 'content-type: application/json' \
    -d '{"path":"operations:activity","args":{},"format":"json"}' 2>/dev/null | grep -o '"state":"running"' | wc -l | tr -d ' '
}
