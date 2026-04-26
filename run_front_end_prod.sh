#!/bin/bash

set -a

# Build configs (package.json, vite.config.ts, tsconfig.json, index.html, etc.)
# now live at the project root, so the build runs in-place. Only the env file
# is still pulled out of /frontend_app (set up by the OS-level installer).

dist_dir=/frontend_app/dist
env_src=/frontend_app/.env

mkdir -p "$dist_dir"
if [ -f "$env_src" ]; then
  cp "$env_src" "$dist_dir/.env"
fi

echo "This build may take up to three minutes. It may be necessary to run 'docker compose rm -f' after the 'docker compose down' command to do a deep cleanup between builds."

echo "Building..."

docker compose -f ./docker-compose-prod.yaml -p upstage-frontend-prod down
docker compose -f ./docker-compose-prod.yaml -p upstage-frontend-prod up -d
docker compose -f ./docker-compose-prod.yaml -p upstage-frontend-prod ps

echo "Done"
