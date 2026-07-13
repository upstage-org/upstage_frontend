#!/usr/bin/env bash
# Dispose of the e2e backend created by e2e-backend-up.sh: remove the API
# container and DROP the upstage_e2e database. Pass --purge to also delete
# /app_code_e2e (uploads + generated load_env override).
set -euo pipefail

PG_CONTAINER=postgres_container_dev
NAME=upstage_backend_e2e
DB=upstage_e2e

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker exec "$PG_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB' AND pid<>pg_backend_pid();" >/dev/null || true
docker exec "$PG_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $DB;"

if [[ "${1:-}" == "--purge" ]]; then
  rm -rf /app_code_e2e
  echo "[e2e-backend] container removed, $DB dropped, /app_code_e2e purged"
else
  echo "[e2e-backend] container removed, $DB dropped (uploads kept; --purge to delete)"
fi
