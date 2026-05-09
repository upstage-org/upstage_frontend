#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

set -a
SITE=dev
FRONTEND_PORT=3001
HOST_UID=1000
HOST_GID=1000
ENV_BACKUP=./env_backup_${SITE}

# static-api-server in container: serves dist/ and proxies /api → studio API on shared Docker network :3000.
# For API-on-host: set before running, e.g. VITE_STUDIO_API_PROXY=http://host.docker.internal:3001
# (backend APP_PORT — never use FRONTEND_PORT here; host.docker.internal→172.17.0.1 often breaks on custom bridges).
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

if [[ "${FRONTEND_PUBLISH_LOCALHOST_ONLY}" == "1" ]]; then
  echo "Frontend container up on 127.0.0.1:${FRONTEND_PORT} — point native nginx proxy_pass there." >&2
else
  echo "Frontend container up; open http://127.0.0.1:${FRONTEND_PORT}/ (or your host IP)." >&2
fi

echo "Done"
