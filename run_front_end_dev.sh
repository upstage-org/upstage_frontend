#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

set -a
SITE=dev
FRONTEND_PORT=3001
HOST_UID=1000
HOST_GID=1000
ENV_BACKUP=./env_backup_${SITE}

# Passed through compose (docker-compose.yaml uses strict "${VITE_STUDIO_API_PROXY}" — no default there).
VITE_STUDIO_API_PROXY=http://host.docker.internal:${FRONTEND_PORT}

# When 0, the frontend preview-server is not started; host nginx must serve built dist/ (or your deploy
# path) and proxy /api. When 1, Docker runs preview-server (static + /api proxy) as today.
ENABLE_FRONTEND_DOCKER_PREVIEW=1


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

if [[ "${ENABLE_FRONTEND_DOCKER_PREVIEW}" == "1" ]]; then
  export COMPOSE_PROFILES=frontend-preview
  "${compose[@]}" down --remove-orphans
  "${compose[@]}" rm -f
  "${compose[@]}" up -d --build
  "${compose[@]}" ps
else
  unset COMPOSE_PROFILES
  "${compose[@]}" down --remove-orphans
  echo "Frontend Docker preview disabled; use host nginx for static assets and /api routing." >&2
fi

echo "Done"
