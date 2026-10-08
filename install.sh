#!/usr/bin/env bash
# Market Radar · installation in one command (Linux server, VPS, Mac with Docker).
#
#   ./install.sh                      # asks for the address, sensible defaults
#   ./install.sh --host 100.64.1.2 --bind 100.64.1.2 --yes   # non-interactive
#
# Options
#   --host ADDRESS   address your browser uses to reach this machine
#                    (LAN IP, Tailscale IP or DNS name). Default: detected.
#   --bind ADDRESS   who can reach the ports: 0.0.0.0 (network), 127.0.0.1
#                    (this machine only) or a Tailscale IP. Default: 0.0.0.0
#   --model NAME     Ollama model. Default: qwen3.5:4b
#   --yes            never ask a question (for scripts and AI agents)
#
# Safe to run again: it keeps .env, your data (Docker volumes) and the model.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=ops/lib.sh
. ops/lib.sh

HOST="" BIND="" MODEL="" ASSUME_YES=false
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST=${2:?--host attend une adresse}; shift 2 ;;
    --bind) BIND=${2:?--bind attend une adresse}; shift 2 ;;
    --model) MODEL=${2:?--model attend un nom de modèle}; shift 2 ;;
    --yes | -y) ASSUME_YES=true; shift ;;
    -h | --help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "Option inconnue : $1 (voir ./install.sh --help)" ;;
  esac
done
interactive() { [ "$ASSUME_YES" = false ] && [ -t 0 ]; }

printf '\033[1mMarket Radar\033[0m · installation locale\n'

say "Vérifications"
require_docker
ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
case "$(uname -m)" in x86_64 | amd64 | aarch64 | arm64) ok "Architecture $(uname -m)" ;; *) warn "Architecture $(uname -m) non testée" ;; esac
if [ -r /proc/meminfo ]; then
  mem=$(awk '/MemTotal/ { printf "%d", $2 / 1024 / 1024 + 0.5 }' /proc/meminfo)
  if [ "$mem" -lt 7 ]; then warn "${mem} Go de RAM : 8 Go conseillés pour l’IA locale (la collecte marche quand même)."; else ok "${mem} Go de RAM"; fi
fi
free_gb=$(df -Pk . | awk 'NR == 2 { printf "%d", $4 / 1024 / 1024 }')
if [ "$free_gb" -lt 15 ]; then warn "${free_gb} Go libres : 15 Go conseillés (images Docker + modèle)."; else ok "${free_gb} Go libres"; fi

say "Configuration (.env)"
fresh=false
if [ ! -f .env ]; then
  cp env.example .env
  chmod 600 .env
  fresh=true
  ok ".env créé depuis env.example"
else
  ok ".env existant conservé"
fi

detect_host() {
  local ip=""
  command -v tailscale >/dev/null 2>&1 && ip=$(tailscale ip -4 2>/dev/null | head -n 1 || true)
  [ -z "$ip" ] && command -v hostname >/dev/null 2>&1 && ip=$(hostname -I 2>/dev/null | awk '{ print $1 }' || true)
  [ -z "$ip" ] && command -v ipconfig >/dev/null 2>&1 && ip=$(ipconfig getifaddr en0 2>/dev/null || true)
  echo "${ip:-localhost}"
}

if [ -z "$HOST" ] && [ "$fresh" = true ]; then
  HOST=$(detect_host)
  if interactive; then
    read -r -p "  Adresse de cette machine vue depuis ton navigateur [$HOST] : " answer
    HOST=${answer:-$HOST}
  fi
fi
if [ -n "$HOST" ]; then
  HOST=${HOST#http://}
  HOST=${HOST#https://}
  HOST=${HOST%%/*}
  HOST=${HOST%%:*}
  env_set CONVEX_PUBLIC_URL "http://$HOST:3210"
  env_set CONVEX_SITE_URL "http://$HOST:3211"
  env_set APP_PUBLIC_URL "http://$HOST:3100"
fi
ok "Adresse publique : $(env_get APP_PUBLIC_URL)"

if [ -z "$BIND" ] && [ "$fresh" = true ] && interactive; then
  read -r -p "  Qui peut accéder à l’app ? 0.0.0.0 = tout le réseau, 127.0.0.1 = cette machine, ou ton IP Tailscale [0.0.0.0] : " BIND
fi
[ -n "$BIND" ] && env_set BIND_ADDRESS "$BIND"
ok "Ports ouverts sur : $(env_get BIND_ADDRESS)"

[ -n "$MODEL" ] && env_set OLLAMA_MODEL "$MODEL"

# The instance secret protects the admin key. Only generated for a new
# database: changing it later would change the admin key.
if [ -z "$(env_get CONVEX_INSTANCE_SECRET)" ] && ! docker volume inspect market-radar-convex-data >/dev/null 2>&1; then
  if command -v openssl >/dev/null 2>&1; then secret=$(openssl rand -hex 32); else secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n'); fi
  env_set CONVEX_INSTANCE_SECRET "$secret"
  ok "Secret Convex généré (dans .env, jamais affiché)"
fi

say "Démarrage de la base (Convex) et de l’IA locale (Ollama)"
docker compose up -d backend dashboard ollama
wait_for_backend
ok "Convex prêt"

model=$(env_get OLLAMA_MODEL)
model=${model:-qwen3.5:4b}
if docker exec market-radar-ollama ollama list 2>/dev/null | awk 'NR > 1 { print $1 }' | grep -qx "$model"; then
  ok "Modèle $model déjà présent"
else
  say "Téléchargement du modèle $model (quelques minutes, ~3 Go)"
  docker exec market-radar-ollama ollama pull "$model"
  ok "Modèle $model prêt"
fi

say "Construction et déploiement des fonctions (2 à 5 minutes la première fois)"
deploy_functions
docker compose build web >/tmp/market-radar-web.log 2>&1 || {
  tail -n 30 /tmp/market-radar-web.log
  die "La construction de l’application web a échoué (log : /tmp/market-radar-web.log)."
}
docker compose up -d web worker
wait_for_web
ok "Application et worker démarrés"

app=$(env_get APP_PUBLIC_URL)
convex=$(env_get CONVEX_PUBLIC_URL)
dash_host=${convex%:3210}
cat <<EOF

$(printf '\033[1m')Market Radar est prêt.$(printf '\033[0m')

  Application     $app
  Convex          $convex
  Tableau Convex  $dash_host:6791   (clé : docker exec market-radar-convex /convex/generate_admin_key.sh)

Ensuite :
  1. Ouvre l’application → onglet « Profils » : crée ton profil (contrats, mots-clés, email).
  2. Dans « Candidature », importe ton CV en PDF : l’IA locale le structure (~3 min), tu le valides.
  3. Onglet « Collecte » → « Lancer une collecte ». Les offres arrivent dans « Radar ».
  4. Extension Chrome (facultatif) : chrome://extensions → Mode développeur →
     « Charger l’extension non empaquetée » → dossier extension/, puis Réglages :
     serveur $convex, application $app.

Mettre à jour : ./ops/update.sh   ·   Sauvegarder : ./ops/backup.sh
EOF
