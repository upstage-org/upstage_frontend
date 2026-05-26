# UpStage Installation

Both repos now follow the same shape: a per-site env file plus a `_dev` / `_prod` run script. Install order is **backend first, then frontend** — the frontend's `.env` points at the backend's GraphQL and MQTT endpoints, so the backend has to exist before the frontend bundle is built.

### Prerequisites

- Docker + `docker compose` (v2). The run scripts call compose for you; you never invoke `docker` directly.
- `sudo` (the run scripts create `/frontend_app_<site>/` and `/app_code_<site>/` and chown them).
- `pnpm` only if you intend to use `run_front_end_*.sh --serve`.

## 1. Backend (`upstage_backend`)

Clone https://github.com/upstage-org/upstage_backend and follow its README. The short version:

1. `./initial_scripts/environments/generate_environments_script.sh` — generates Postgres / MQTT / FastAPI secrets, fills `src/global_config/load_env.py`, `container_scripts/mqtt_server/pw.txt`, and the service-containers run script.
2. `cd service_containers && ./run_docker_compose_dev.sh` (or `_prod.sh`) — brings up Postgres + Mosquitto.
3. `cd ../app_containers && ./run_docker_compose_dev.sh` (or `_prod.sh`) — brings up the FastAPI app.

## 2. Frontend (this repo)

1. Create a per-site env file by copying [`env.template`](env.template):

   ```bash
   cp env.template env_backup_dev    # or env_backup_prod
   ```

   Edit it to match your backend. The values that almost always need changing:
   - `VITE_GRAPHQL_ENDPOINT` — must point at the backend you brought up in step 1 (e.g. `https://dev.your-domain/api/`).
   - `VITE_MQTT_ENDPOINT`, `VITE_MQTT_USERNAME`, `VITE_MQTT_PASSWORD` — match the Mosquitto password you set in the backend's MQTT password file.
   - `VITE_JITSI_ENDPOINT` — your streaming host (or `http://localhost/` for local-only).
   - `VITE_CLOUDFLARE_CAPTCHA_SITEKEY`, `VITE_STRIPE_KEY` — set if you're enabling those integrations.
   - `VITE_ENV_TYPE=Production` for hardened deploys; anything else disables CAPTCHA + CORS for local dev.

2. Run the matching script:

   ```bash
   ./run_front_end_dev.sh         # writes a built dist/ to /frontend_app_dev/dist
   ./run_front_end_prod.sh        # same, for /frontend_app_prod/dist
   ./run_front_end_dev.sh --serve # Vite dev server on :3001 with HMR (host-side, no build)
   ./run_front_end_prod.sh --serve # same, on :3002
   ```

   The script copies `env_backup_<site>` to both `/frontend_app_<site>/.env` and `./.env`, then either produces a built `dist/` at `/frontend_app_<site>/dist/` for host nginx to serve (default `--build`), or runs Vite directly on the host (`--serve`).

   The dev/prod distinction only changes `${SITE}` — the per-site output dir and the per-site env file. `--build` vs `--serve` is independent of that.

## 3. Verify

- `--build` mode: point your host nginx alias at `/frontend_app_<site>/dist/` and open `https://<your-domain>`.
- `--serve` mode: open `http://localhost:3001` (dev) or `http://localhost:3002` (prod).

Testing:

pnpm e2e:features

# Default (today's behavior): all three phases headed, no replay headless.

PWHEADLESS=0 pnpm e2e:perform

# Just rehearsal: cast walks the script in rehearsal mode, no audience.

PWHEADLESS=0 pnpm e2e:perform:rehearsal

# Just live: cast performs while audience watches; no rehearsal, no replay.

PWHEADLESS=0 pnpm e2e:perform:live

# Just replay: no cast logins. Audience watches the most recent recording.

# Errors clearly if no Performance exists for the stage yet.

PWHEADLESS=0 pnpm e2e:perform:replay

# Arbitrary combos via the env var:

PWHEADLESS=0 E2E_PHASES=live,replay pnpm e2e:perform # skip rehearsal
PWHEADLESS=0 E2E_PHASES=rehearsal,replay pnpm e2e:perform # rare; replay against latest existing recording

# Smoke beats still works on top of any phase selection:

PWHEADLESS=0 E2E_PHASES=live E2E_BEATS=smoke pnpm e2e:perform

E2E_REPLAY still works as a fallback default when E2E_PHASES is unset.

## Local protections (git hooks)

This repo uses [husky](https://typicode.github.io/husky) to run a small
suite of local protections against the same checks that run in CI. They
exist so problems are caught at the developer's machine — before they
hit `main` — and so a `git push --no-verify` bypass is still caught
server-side by `.github/workflows/ci.yml`.

### One-time install

```bash
pnpm install
```

The `prepare` script runs `husky` automatically and installs the hooks
into `.husky/`. If pnpm 10/11 prompts about build scripts, run
`pnpm approve-builds husky` once.

### What runs and when

| Hook         | What it does                                                                             | Typical time |
| ------------ | ---------------------------------------------------------------------------------------- | ------------ |
| `pre-commit` | `lint-staged`: ESLint `--fix` + Prettier `--write` on staged JS/TS/Vue/JSON/MD/SCSS only | < 5 s        |
| `commit-msg` | Light gate: rejects empty / `wip` / `fixup!` / messages shorter than 10 characters       | instant      |
| `pre-push`   | `pnpm typecheck` + `pnpm test` + `pnpm audit:ci` (production deps, fail on `high`+)      | ~30–35 s     |

The `pre-push` hook is intentionally identical to the `verify` script
and to the CI workflow, so a clean local push is a strong signal that
CI will pass.

### Manual run

```bash
pnpm run verify        # typecheck + tests + audit
pnpm run typecheck     # vue-tsc only
pnpm run audit:ci      # production audit, fail on high+
```

### Bypassing for emergencies

Both hooks honour git's standard escape hatch:

```bash
git commit --no-verify -m "hotfix: ..."
git push --no-verify
```

Use sparingly. CI will still run the full verify suite on the pushed
branch and on the PR, so a bypass only delays the failure — it does not
hide it.

### Adding a new check

1. Add a script to `package.json` so it can be run standalone (e.g.
   `pnpm run my-check`).
2. Add the same script to `.husky/pre-push` (and update the `verify`
   script if it should be part of the bundle).
3. Add the matching step to `.github/workflows/ci.yml` so the local
   gate and the server-side gate stay in lockstep.
