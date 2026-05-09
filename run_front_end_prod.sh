#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

set -a
SITE=prod
FRONTEND_PORT=3002
HOST_UID=1000
HOST_GID=1000
ENV_BACKUP=./env_backup_${SITE}

VITE_STUDIO_API_PROXY="${VITE_STUDIO_API_PROXY:-http://upstage_backend:3000}"

sudo mkdir -p /frontend_app_${SITE}
env_src="/frontend_app_${SITE}/.env"

if [[ -f "${ENV_BACKUP}" ]]; then
  sudo cp ${ENV_BACKUP} "$env_src"
  echo "Copying existing file: ${ENV_BACKUP} to ${env_src}" >&2
else
  echo "${ENV_BACKUP} is missing. Create this file from env.template" >&2
  exit 1
fi

compose=(docker compose -f docker-compose.yaml -p "upstage-frontend-${SITE}")

"${compose[@]}" down --remove-orphans
"${compose[@]}" rm -f
"${compose[@]}" up -d --build
"${compose[@]}" ps

echo "Frontend container up on 127.0.0.1:${FRONTEND_PORT} — point native nginx proxy_pass there, or browse directly on loopback." >&2

echo "Done"
