#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--build | --serve]

  --build  (default) Build the SPA in a one-shot docker container and write
           the resulting dist/ to /frontend_app_prod/dist on the host. Host
           nginx (or any other static-file server) serves from that path.

  --serve  Skip docker entirely. Run \`pnpm run dev\` directly on the host
           (Vite dev server with HMR) bound to 0.0.0.0:\${FRONTEND_PORT}.
           Foreground; Ctrl-C to stop.

The dev/prod distinction only affects \${SITE} (the per-site output dir under
/frontend_app_<site>/ and the per-site .env). Whether to serve via Vite or
build to disk is independent of SITE and chosen by this flag.
EOF
}

MODE=build
while [[ $# -gt 0 ]]; do
  case "$1" in
    --serve) MODE=serve; shift ;;
    --build) MODE=build; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

set -a
SITE=prod
FRONTEND_PORT=3002
HOST_UID=1000
HOST_GID=1000
ENV_BACKUP=./env_backup_${SITE}
# Exposes window.__UPSTAGE_PINIA__ for the Playwright e2e suites.
# Belt-and-suspenders alongside env_backup_prod so a wiped backup still builds e2e-ready.
VITE_E2E=1

sudo mkdir -p /frontend_app_${SITE}
env_src="/frontend_app_${SITE}/.env"

if [[ -f "${ENV_BACKUP}" ]]; then
  sudo cp ${ENV_BACKUP} "$env_src"
  echo "Copying existing file: ${ENV_BACKUP} to ${env_src}" >&2
  # Also seed the workspace `.env` so the docker build context (and Vite dev
  # in --serve mode) sees the populated env file. Vite's loadEnv reads from
  # the cwd. `.env` is gitignored.
  cp "${ENV_BACKUP}" ./.env
  echo "Copying existing file: ${ENV_BACKUP} to ./.env (for vite)" >&2
else
  echo "${ENV_BACKUP} is missing. Create this file from env.template" >&2
  exit 1
fi

if [[ "$MODE" == "serve" ]]; then
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm not found on PATH. Install it (e.g. \`corepack enable && corepack prepare pnpm@10.7.1 --activate\`) and try again." >&2
    exit 1
  fi
  echo "--serve: running Vite dev server on 0.0.0.0:${FRONTEND_PORT} (no docker)." >&2
  pnpm install --frozen-lockfile
  # NOTE: bypass the `dev` npm script (which hardcodes `--port=3000`). With
  # `pnpm run dev -- --port=...` pnpm passes the extras after a literal `--`,
  # which Vite then treats as positional args and ignores. `pnpm exec` runs
  # the binary directly so our flags are the only ones present.
  # --force purges node_modules/.vite/ and re-pre-bundles deps so the dev
  # server always starts from a freshly-built module graph.
  exec pnpm exec vite --port="${FRONTEND_PORT}" --host --force
fi

# --- --build (default) ---
# Pre-create the output directory and chown it so the container (running as
# HOST_UID:HOST_GID) can write into the bind mount.
sudo mkdir -p /frontend_app_${SITE}/dist
sudo chown -R "${HOST_UID}:${HOST_GID}" /frontend_app_${SITE}/dist

# Per-run timestamp invalidates the docker layer cache from the vite-build
# step onward, so `pnpm run build` actually re-executes every invocation
# even when no source files changed. Earlier layers (base image, pnpm install)
# are still cache-hit, keeping the rebuild fast.
CACHE_BUST=$(date +%s%N)

compose=(docker compose -f docker-compose.yaml -p "upstage-frontend-${SITE}")

"${compose[@]}" down --remove-orphans
"${compose[@]}" rm -f
# `run --rm` is the canonical one-shot invocation: builds the image,
# runs the container in the foreground, removes it on exit.
"${compose[@]}" run --rm --build upstage_frontend

echo "Built dist/ written to /frontend_app_${SITE}/dist — point your host nginx (alias /frontend_app_${SITE}/dist/) there." >&2

echo "Done"
