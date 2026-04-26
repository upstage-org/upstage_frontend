#!/usr/bin/env bash
#
# setup_local_nginx.sh
#
# One-shot local helper for serving the Upstage SPA + dev backend through the
# host nginx on http://localhost/. Idempotent and re-runnable.
#
# What it does, in order:
#   1. Re-executes itself under sudo if not already root.
#   2. Warns (but does not fail) if /frontend_app_dev/dist or
#      /app_code_dev/uploads are missing.
#   3. On Fedora/RHEL with SELinux Enforcing, installs a persistent file
#      context rule (httpd_sys_content_t) for both dev paths and runs
#      restorecon, so nginx (httpd_t) can read them.
#   4. Installs upstage-local.conf into /etc/nginx/conf.d/.
#   5. If `nginx -t` reports a duplicate default_server collision (the stock
#      Fedora server block in /etc/nginx/nginx.conf claims default_server too),
#      backs up nginx.conf once and strips the `default_server` flag from any
#      `listen` directive in it.
#   6. Reloads nginx and curls http://127.0.0.1/ as a smoke test.
#
# This script is intentionally local-only. It does NOT modify any installer,
# initial_scripts/, scripts/, compose, env, or build files in the repo.

set -euo pipefail

# ----- privilege ------------------------------------------------------------

if [[ ${EUID} -ne 0 ]]; then
  exec sudo -E "$0" "$@"
fi

# ----- locate sibling conf --------------------------------------------------

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
SRC_CONF="${SCRIPT_DIR}/upstage-local.conf"
DST_CONF="/etc/nginx/conf.d/upstage-local.conf"

if [[ ! -f "${SRC_CONF}" ]]; then
  echo "error: ${SRC_CONF} not found" >&2
  exit 1
fi

# ----- helpers --------------------------------------------------------------

log()  { printf '\033[1;34m[setup-local-nginx]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup-local-nginx]\033[0m %s\n' "$*" >&2; }

# ----- prereq dirs ----------------------------------------------------------

DEV_DIST="/frontend_app_dev/dist"
DEV_UPLOADS="/app_code_dev/uploads"

for d in "${DEV_DIST}" "${DEV_UPLOADS}"; do
  if [[ ! -d "${d}" ]]; then
    warn "${d} does not exist yet. nginx -t will still pass, but the SPA / uploads will 404 until run_front_end_dev.sh and the backend dev container have populated them."
  fi
done

# ----- SELinux relabel ------------------------------------------------------

selinux_relabel() {
  local path="$1"

  [[ -e "${path}" ]] || { warn "skipping SELinux relabel for ${path} (does not exist)"; return; }

  # -a adds a new rule; -m modifies an existing one. Run -a first; if it fails
  # because the rule already exists, fall back to -m. This keeps the script
  # idempotent without grep-parsing semanage output.
  if ! semanage fcontext -a -t httpd_sys_content_t "${path}(/.*)?" 2>/dev/null; then
    semanage fcontext -m -t httpd_sys_content_t "${path}(/.*)?"
  fi
  restorecon -R "${path}" >/dev/null
}

if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce)" != "Disabled" ]]; then
  log "SELinux is $(getenforce); applying httpd_sys_content_t to dev paths"

  if ! command -v semanage >/dev/null 2>&1; then
    log "installing policycoreutils-python-utils for semanage"
    if command -v dnf >/dev/null 2>&1; then
      dnf install -y policycoreutils-python-utils
    else
      echo "error: semanage is missing and dnf is unavailable; install policycoreutils-python-utils manually" >&2
      exit 1
    fi
  fi

  selinux_relabel "${DEV_DIST%/dist}" # /frontend_app_dev (parent, so dist + future siblings inherit)
  selinux_relabel "${DEV_UPLOADS}"
else
  log "SELinux disabled or unavailable; skipping relabel"
fi

# ----- install conf ---------------------------------------------------------

log "installing ${DST_CONF}"
install -m 0644 "${SRC_CONF}" "${DST_CONF}"

# ----- defang Fedora default_server collision -------------------------------

NGINX_MAIN="/etc/nginx/nginx.conf"

run_nginx_test() {
  # Capture stderr (where nginx -t writes) into a temp file we can grep.
  local out
  out="$(mktemp)"
  if nginx -t 2>"${out}"; then
    rm -f "${out}"
    return 0
  fi
  cat "${out}" >&2
  if grep -q 'duplicate default server' "${out}"; then
    rm -f "${out}"
    return 2
  fi
  rm -f "${out}"
  return 1
}

if ! run_nginx_test; then
  rc=$?
  if [[ ${rc} -eq 2 ]]; then
    log "duplicate default_server detected; patching ${NGINX_MAIN}"

    # Take a one-time backup. If a backup already exists, leave it alone so we
    # never overwrite the pristine original on a second run.
    if ! compgen -G "${NGINX_MAIN}.bak.*" >/dev/null; then
      backup="${NGINX_MAIN}.bak.$(date +%Y%m%d-%H%M%S)"
      cp -a "${NGINX_MAIN}" "${backup}"
      log "backup written to ${backup}"
    else
      log "existing backup found; leaving it untouched"
    fi

    # Strip the default_server flag from any `listen ...` directive in the
    # main config. Leaves the stock server block intact otherwise.
    sed -i -E 's/(listen[[:space:]]+[^;]*[[:space:]])default_server([[:space:]]|;)/\1\2/g' "${NGINX_MAIN}"
    sed -i -E 's/(listen[[:space:]]+[^;]*)[[:space:]]+default_server;/\1;/g' "${NGINX_MAIN}"

    if ! nginx -t; then
      echo "error: nginx -t still failing after patching ${NGINX_MAIN}." >&2
      echo "       look for `default_server` in /etc/nginx/conf.d/*.conf and remove it manually." >&2
      exit 1
    fi
  else
    echo "error: nginx -t failed for a reason other than default_server collision; aborting." >&2
    exit 1
  fi
fi

# ----- reload + smoke test --------------------------------------------------

log "reloading nginx"
systemctl reload nginx

log "smoke-testing http://127.0.0.1/"
status="$(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1/ || true)"

case "${status}" in
  200)
    log "OK -- http://127.0.0.1/ responded 200"
    ;;
  403|404)
    warn "got HTTP ${status}. Most likely cause: ${DEV_DIST}/index.html is missing. Run run_front_end_dev.sh once it builds."
    ;;
  "")
    warn "curl could not reach the server; check 'systemctl status nginx' and /var/log/nginx/error.log"
    ;;
  *)
    warn "unexpected HTTP ${status}; tail of /var/log/nginx/error.log:"
    tail -n 20 /var/log/nginx/error.log >&2 || true
    ;;
esac

# ----- summary --------------------------------------------------------------

cat <<SUMMARY

Local nginx is configured. Try:
  http://localhost/                -> SPA  (alias ${DEV_DIST})
  http://localhost/api/            -> dev backend on host port 3001
  http://localhost/resources/...   -> alias ${DEV_UPLOADS}

Files touched on this host:
  ${DST_CONF}
$(ls -1 "${NGINX_MAIN}".bak.* 2>/dev/null | sed 's/^/  /' || true)

Re-run this script any time; it is idempotent.
SUMMARY
