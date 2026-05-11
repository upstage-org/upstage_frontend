#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

set -a
SITE=prod
FRONTEND_PORT=3002
HOST_UID=1000
HOST_GID=1000
ENV_BACKUP=./env_backup_${SITE}
# Exposes window.__UPSTAGE_PINIA__ for the Playwright e2e suites.
# Belt-and-suspenders alongside env_backup_prod so a wiped backup still builds e2e-ready.
VITE_E2E=1

# static-api-server in container: serves dist/ and proxies /api → studio API on shared Docker network :3000.
# For API-on-host: set before running, e.g. VITE_STUDIO_API_PROXY=http://host.docker.internal:3001
# (backend APP_PORT — never use FRONTEND_PORT here; host.docker.internal→172.17.0.1 often breaks on custom bridges).
#VITE_STUDIO_API_PROXY="${VITE_STUDIO_API_PROXY:-http://upstage_backend:3000}"
#VITE_STUDIO_API_PROXY="http://host.docker.internal:3000"

sudo mkdir -p /frontend_app_${SITE}
env_src="/frontend_app_${SITE}/.env"

if [[ -f "${ENV_BACKUP}" ]]; then
  sudo cp ${ENV_BACKUP} "$env_src"
  echo "Copying existing file: ${ENV_BACKUP} to ${env_src}" >&2
  # Also seed the workspace `.env` so the docker build context contains the
  # populated env file. Vite (inside the builder stage) loads `.env` from the
  # repo root via `loadEnv`, and without this all VITE_* end up undefined and
  # the SPA breaks (no MQTT URL, asset 404s, etc.). `.env` is gitignored.
  cp "${ENV_BACKUP}" ./.env
  echo "Copying existing file: ${ENV_BACKUP} to ./.env (for vite build context)" >&2
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
