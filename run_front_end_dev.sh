#!/bin/bash

set -a
SITE=dev
DOMAIN=de.upstage.live
# Published as host:container (${FRONTEND_PORT}:${FRONTEND_PORT}); also passed to vite `preview.port`.
# Must be ≥1024 for typical non-root UIDs inside the container.
FRONTEND_PORT=3001
HOST_UID=0
HOST_GID=0

# Build configs (package.json, vite.config.ts, tsconfig.json, index.html, etc.)
# now live at the project root, so the build runs in-place. Only the env file
# is still pulled out of /frontend_app_${SITE} (set up by the OS-level installer).

dist_root=/frontend_app_${SITE}
dist_dir=${dist_root}/dist
env_src=/frontend_app_${SITE}/.env

mkdir -p "$dist_dir"
if [ -f "$env_src" ]; then
  cp "$env_src" "$dist_dir/.env"
fi

cp vite.config.ts.template vite.config.ts
sed "s/REPLACE_THIS/${DOMAIN}/g" vite.config.ts
echo "This build may take up to three minutes. It may be necessary to run 'docker compose rm -f' after the 'docker compose down' command to do a deep cleanup between builds."

echo "Building..."
sudo chown -R ${HOST_UID}:${HOST_GID} ${dist_root}
docker compose -f ./docker-compose.yaml -p upstage-frontend-${SITE} down
sudo chown -R ${HOST_UID}:${HOST_GID} ${dist_root}
docker compose -f ./docker-compose.yaml -p upstage-frontend-${SITE} up -d --build
docker compose -f ./docker-compose.yaml -p upstage-frontend-${SITE} ps

echo "Done"
