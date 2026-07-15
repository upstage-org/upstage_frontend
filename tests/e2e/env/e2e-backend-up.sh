#!/usr/bin/env bash
# Disposable e2e backend: a fresh `upstage_e2e` database (inside the existing
# dev postgres container) + its own API container on 127.0.0.1:9092 + its own
# uploads dir. Playwright then authors users/media/stages HERE instead of the
# live dev DB (which it once polluted — including a real user's media library).
#
#   tests/e2e/env/e2e-backend-up.sh     # (re)create everything, fresh DB
#   tests/e2e/env/vite-e2e.sh           # SPA on :3001 pointed at :9092
#   E2E_SKIP_CONFIRM=1 PWHEADLESS=1 pnpm e2e
#   tests/e2e/env/e2e-backend-down.sh   # dispose (drops the DB)
#
# Why override load_env.py instead of container env vars: the backend's
# global_config/env.py exec's load_env.py AFTER reading os.environ, so the
# baked-in file always wins — retargeting the DB requires bind-mounting a
# modified copy over /usr/app/src/upstage_backend/global_config/load_env.py.
#
# Shares upstage-network-dev (postgres + mosquitto). NEVER attach this to
# `upstage-network` (no suffix): that network's aliases resolve to PROD.
set -euo pipefail

PG_CONTAINER=postgres_container_dev
IMAGE=upstage/backend:dev
NAME=upstage_backend_e2e
DB=upstage_e2e
PORT=9092
NET=upstage-network-dev
E2E_ROOT=/app_code_e2e
CONF_DIR=$E2E_ROOT/conf
UPLOADS_DIR=$E2E_ROOT/uploads

docker image inspect "$IMAGE" >/dev/null
docker container inspect "$PG_CONTAINER" >/dev/null

docker rm -f "$NAME" >/dev/null 2>&1 || true

echo "[e2e-backend] recreating database $DB ..."
docker exec "$PG_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB' AND pid<>pg_backend_pid();" >/dev/null
docker exec "$PG_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $DB;"
docker exec "$PG_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $DB;"

mkdir -p "$CONF_DIR" "$UPLOADS_DIR"
chown 1000:1000 "$UPLOADS_DIR"

# Derive the override from the image's own load_env.py so we never commit
# secrets and never drift from the deployed config shape.
docker run --rm "$IMAGE" cat /usr/app/src/upstage_backend/global_config/load_env.py \
  > "$CONF_DIR/load_env.py"
python3 - "$CONF_DIR/load_env.py" <<'PYEOF'
import re, sys

path = sys.argv[1]
src = open(path).read()

def set_str(name, value, s):
    out, n = re.subn(rf"^{name}\s*=.*$", f'{name} = "{value}"', s, count=1, flags=re.M)
    if n != 1:
        raise SystemExit(f"[e2e-backend] could not override {name} in load_env.py")
    return out

src = set_str("DATABASE_NAME", "upstage_e2e", src)
# The e2e instance must never reach live Stripe or send real email.
src = set_str("STRIPE_KEY", "", src)
src = set_str("STRIPE_PRODUCT_ID", "", src)
src = set_str("EMAIL_HOST", "", src)
src = set_str("EMAIL_HOST_PASSWORD", "", src)

open(path, "w").write(src)
print("[e2e-backend] load_env override written (DB=upstage_e2e, Stripe/email disabled)")
PYEOF

MOUNTS=(
  -v "$CONF_DIR/load_env.py:/usr/app/src/upstage_backend/global_config/load_env.py:ro"
  -v "$UPLOADS_DIR:/usr/app/uploads"
)

echo "[e2e-backend] running migrations (also seeds admin / Secret@123) ..."
docker run --rm --network "$NET" --user 1000:1000 "${MOUNTS[@]}" "$IMAGE" \
  bash -c "cd /usr/app && python -m alembic -c ./scripts/alembic.ini upgrade heads"

echo "[e2e-backend] starting $NAME on 127.0.0.1:$PORT ..."
docker run -d --name "$NAME" --network "$NET" --user 1000:1000 \
  -p "127.0.0.1:$PORT:3000" "${MOUNTS[@]}" "$IMAGE" \
  bash -c "cd /usr/app && export HARDCODED_HOSTNAME=localhost && ./scripts/start_upstage.sh" >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null -X POST -H 'content-type: application/json' \
    --data '{"query":"{ __typename }"}' "http://127.0.0.1:$PORT/api/studio_graphql" 2>/dev/null; then
    echo "[e2e-backend] ready: http://127.0.0.1:$PORT/api/studio_graphql (db=$DB, uploads=$UPLOADS_DIR)"
    exit 0
  fi
  sleep 1
done

echo "[e2e-backend] FAILED to become healthy; last logs:" >&2
docker logs --tail 50 "$NAME" >&2
exit 1
