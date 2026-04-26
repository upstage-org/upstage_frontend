#!/bin/bash

set -a

# Container runs as the host user (see docker-compose-dev.yaml). Exporting
# these here makes the compose ${HOST_UID}/${HOST_GID} interpolation
# deterministic without anyone having to hand-edit .env.compose.
export HOST_UID="$(id -u)"
export HOST_GID="$(id -g)"

# Build configs (package.json, vite.config.ts, tsconfig.json, index.html, etc.)
# now live at the project root, so the build runs in-place. Only the env file
# is still pulled out of /frontend_app_dev (set up by the OS-level installer).

dist_dir=/frontend_app_dev/dist
env_src=/frontend_app_dev/.env

mkdir -p "$dist_dir"
if [ -f "$env_src" ]; then
  cp "$env_src" "$dist_dir/.env"
fi

echo "This build may take up to three minutes. It may be necessary to run 'docker compose rm -f' after the 'docker compose down' command to do a deep cleanup between builds."

echo "Building..."

docker compose --env-file ./.env.compose -f ./docker-compose-dev.yaml -p upstage-frontend-dev down
docker compose --env-file ./.env.compose -f ./docker-compose-dev.yaml -p upstage-frontend-dev up -d --build
docker compose --env-file ./.env.compose -f ./docker-compose-dev.yaml -p upstage-frontend-dev ps

echo "Done"
