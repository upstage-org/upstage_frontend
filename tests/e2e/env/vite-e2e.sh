#!/usr/bin/env bash
# SPA for e2e runs: vite dev server on 127.0.0.1:3001 (E2E_BASE_URL default)
# pointed at the disposable e2e backend (:9092) and serving the e2e uploads
# dir at /resources/. Runs from source — never builds dist/ (the built dist
# is the live dev site).
set -euo pipefail
cd "$(dirname "$0")/../../.."

# VITE_STUDIO_API_PROXY matters as much as VITE_GRAPHQL_ENDPOINT: vite proxies
# origin-relative `/api/*` (used by page-side helpers like assignMediaIds) and
# defaults to the DEV backend on 9090 — leaving it unset would leak e2e writes
# into the shared dev DB through the proxy.
exec env \
  VITE_GRAPHQL_ENDPOINT=http://127.0.0.1:9092/api/ \
  VITE_STUDIO_API_PROXY=http://127.0.0.1:9092 \
  LOCAL_SERVE_STATIC_CONTENT=/app_code_e2e/uploads \
  npx vite --port "${E2E_VITE_PORT:-3001}" --host 127.0.0.1 --strictPort
