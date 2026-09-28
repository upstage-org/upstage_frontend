#!/usr/bin/env bash
# Event-archive worker for the disposable e2e database, so stage events land
# in `upstage_e2e.events` and a reloaded e2e stage is replayed. Needed only by
# the "persisted jitsi tile re-publishes after performer navigates away/back"
# streaming test (E2E_EVENT_ARCHIVE=1). Stop it afterwards: the other e2e
# tests expect an empty board.
#
#   tests/e2e/env/e2e-archive-up.sh
#   JITSI_E2E_LIVE=1 E2E_EVENT_ARCHIVE=1 pnpm exec playwright test --project=streaming -g "persisted jitsi tile"
#   docker rm -f upstage_event_archive_e2e
#
# Reuses the load_env.py override written by e2e-backend-up.sh (DB=upstage_e2e).
# The worker subscribes to every topic on the dev broker, so it also copies
# events from dev stages into upstage_e2e; it only INSERTs there and never
# writes to the dev database.
set -euo pipefail

IMAGE=upstage/backend:dev
NAME=upstage_event_archive_e2e
NET=upstage-network-dev
CONF=/app_code_e2e/conf/load_env.py

grep -q '^DATABASE_NAME = "upstage_e2e"$' "$CONF" || {
  echo "[e2e-archive] $CONF is missing or not pointed at upstage_e2e; run e2e-backend-up.sh first" >&2
  exit 1
}

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --network "$NET" --user 1000:1000 \
  -v "$CONF:/usr/app/src/upstage_backend/global_config/load_env.py:ro" \
  "$IMAGE" bash -c "cd /usr/app && export HARDCODED_HOSTNAME=localhost && ./scripts/run_event_archive.sh" >/dev/null

for _ in $(seq 1 30); do
  if docker logs "$NAME" 2>&1 | grep -q "event_archive: connected"; then
    echo "[e2e-archive] $NAME archiving into upstage_e2e"
    exit 0
  fi
  sleep 1
done
echo "[e2e-archive] worker did not connect; last logs:" >&2
docker logs --tail 30 "$NAME" >&2
exit 1
