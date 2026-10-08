#!/usr/bin/env bash
# Updates Market Radar: new code, Convex functions, web app and worker.
# Keeps .env and every piece of data (Docker volumes).
#
#   ./ops/update.sh            # refuses while a task is running
#   ./ops/update.sh --force    # restarts anyway (the running task is retried)
set -euo pipefail
cd "$(dirname "$0")/.."
. ops/lib.sh

FORCE=false
[ "${1:-}" = --force ] && FORCE=true

require_docker
[ -f .env ] || die ".env manquant : lance d’abord ./install.sh"

if [ -d .git ]; then
  say "Récupération du code"
  git pull --ff-only
fi

running=$(running_tasks || echo 0)
if [ "${running:-0}" -gt 0 ] && [ "$FORCE" = false ]; then
  die "$running tâche(s) en cours (collecte, IA…). Réessaie dans quelques minutes, ou --force."
fi

say "Déploiement"
docker compose up -d backend dashboard ollama
wait_for_backend
deploy_functions
docker compose build web >/tmp/market-radar-web.log 2>&1 || {
  tail -n 30 /tmp/market-radar-web.log
  die "La construction de l’application web a échoué."
}
docker compose up -d --no-deps --force-recreate web worker
wait_for_web
ok "Market Radar est à jour : $(env_get APP_PUBLIC_URL)"
