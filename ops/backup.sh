#!/usr/bin/env bash
# Exports the whole Convex database (offers, profiles, CVs, applications,
# tracking, PDF files) to backups/market-radar-<date>.zip.
#
# Restore on a fresh install (replaces everything!):
#   docker compose run --rm --no-deps -v "$PWD/backups:/backups" \
#     -e CONVEX_SELF_HOSTED_URL=http://backend:3210 \
#     -e CONVEX_SELF_HOSTED_ADMIN_KEY="$(docker exec market-radar-convex /convex/generate_admin_key.sh | tail -n 1)" \
#     worker npx convex import --replace-all /backups/<file>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
. ops/lib.sh

require_docker
mkdir -p backups
chmod 700 backups
file="market-radar-$(date +%Y%m%d-%H%M).zip"
admin_key=$(docker exec market-radar-convex /convex/generate_admin_key.sh 2>/dev/null | tail -n 1)
[ -n "$admin_key" ] || die "Convex ne répond pas (docker compose ps)."

say "Export de la base"
docker compose run --rm --no-deps -v "$PWD/backups:/backups" \
  -e CONVEX_SELF_HOSTED_URL=http://backend:3210 \
  -e CONVEX_SELF_HOSTED_ADMIN_KEY="$admin_key" \
  worker npx convex export --include-file-storage --path "/backups/$file"
# The container writes as root: give the file back to you, readable by you only.
docker compose run --rm --no-deps -v "$PWD/backups:/backups" worker \
  sh -c "chown $(id -u):$(id -g) '/backups/$file' && chmod 600 '/backups/$file'" >/dev/null
ok "Sauvegarde : backups/$file (contient tes CV : garde-la en lieu sûr)"
