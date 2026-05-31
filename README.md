# UpStage Frontend

Vue 3 SPA for UpStage players and audience. Production deploys serve a static `dist/` bundle from host nginx.

**Install is not run from this repo directly.** The backend single-host installer (phase `90_frontend`) invokes `run_front_end_{dev,prod}.sh` here. See the [backend README](../upstage_backend/README.md).

## Installation

From the backend installer:

```sh
cd upstage_backend/installation
./install_single_host.sh --all
```

Before running (or before re-running phase `90_frontend`), prepare your per-site env files in this repo — see [Configuration](#configuration) below.

### Prerequisites

- The single-host installer handles Docker; you do not invoke `docker compose` directly for production installs.
- `pnpm` is only needed if you use `run_front_end_*.sh --serve` for optional local dev (see [Run scripts](#run-scripts)).

## Configuration

Each site has a gitignored env backup plus a matching run script:

```bash
cp env.template env_backup_dev     # or env_backup_prod
# edit values, then run the installer (or re-run phase 90_frontend)
```

- Only [`env.template`](env.template) is committed. `env_backup*` files are gitignored and live on the host.
- Create `env_backup_prod` the same way as `env_backup_dev`.

### Variables

| Variable                                              | Purpose                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `VITE_GRAPHQL_ENDPOINT`                               | Backend API URL (baked at build time)                                |
| `VITE_STATIC_ASSETS_ENDPOINT`                         | Upload URL prefix (default `/resources/`)                            |
| `VITE_MQTT_NAMESPACE`                                 | MQTT topic prefix                                                    |
| `VITE_MQTT_ENDPOINT`                                  | WebSocket MQTT URL                                                   |
| `VITE_MQTT_USERNAME` / `VITE_MQTT_PASSWORD`           | Match backend Mosquitto `performance` user                           |
| `VITE_JITSI_ENDPOINT`                                 | Streaming host from installer `state.env`                            |
| `VITE_CLOUDFLARE_CAPTCHA_SITEKEY`                     | Turnstile site key                                                   |
| `VITE_STRIPE_KEY`                                     | Stripe publishable key                                               |
| `VITE_RELEASE_VERSION` / `VITE_ALIAS_RELEASE_VERSION` | Display version strings                                              |
| `VITE_ENV_TYPE`                                       | `Production` → CAPTCHA + CORS; anything else → relaxed dev           |
| `VITE_E2E`                                            | Exposes Pinia for Playwright (dev/test)                              |
| `LOCAL_SERVE_STATIC_CONTENT`                          | **Required for `--serve` only** — path to `/app_code_<site>/uploads` |

See also [`.env.example`](.env.example) for inline comments (including optional Jitsi XMPP overrides).

### Dev vs prod example values

Use your actual domain; placeholders shown below:

|                              | dev                           | prod                      |
| ---------------------------- | ----------------------------- | ------------------------- |
| `VITE_GRAPHQL_ENDPOINT`      | `https://dev.<domain>/api/`   | `https://<domain>/api/`   |
| `VITE_MQTT_ENDPOINT`         | `wss://mqtt-dev.<domain>:443` | `wss://mqtt.<domain>:443` |
| `LOCAL_SERVE_STATIC_CONTENT` | `/app_code_dev/uploads`       | `/app_code_prod/uploads`  |

## Run scripts

[`run_front_end_dev.sh`](run_front_end_dev.sh) and [`run_front_end_prod.sh`](run_front_end_prod.sh) are invoked by the installer (default **`--build`**). Re-run them manually after config changes if needed.

| Mode                            | Flag                 | Behavior                                                                                         |
| ------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| **Build** (default, production) | `--build` or no flag | One-shot Docker compose build → `dist/` at `/frontend_app_<site>/dist/` for nginx                |
| **Serve** (local dev only)      | `--serve`            | Host Vite HMR on `:3001` (dev) or `:3002` (prod); requires `pnpm` + `LOCAL_SERVE_STATIC_CONTENT` |

- **`SITE`** (dev vs prod) and **`--build` vs `--serve`** are independent choices.
- The script copies `env_backup_<site>` → `/frontend_app_<site>/.env` and `./.env`.
- `--serve` is not used by the production installer.

Host paths:

| Path                                               | Purpose                                      |
| -------------------------------------------------- | -------------------------------------------- |
| `/frontend_app_dev/` / `/frontend_app_prod/`       | `.env` + built `dist/`                       |
| `/app_code_dev/uploads` / `/app_code_prod/uploads` | Backend media (for `--serve` static serving) |

## Verify

- **Production (`--build`):** nginx serves `/frontend_app_<site>/dist/` at your app domain.
- **`--serve` only:** open `http://localhost:3001` (dev) or `http://localhost:3002` (prod).

## Testing

End-to-end tests use Playwright. See [`tests/e2e/README.md`](tests/e2e/README.md) for full setup.

```bash
pnpm e2e:features

# Default: all three phases headed, no replay headless.
PWHEADLESS=0 pnpm e2e:perform

# Just rehearsal: cast walks the script in rehearsal mode, no audience.
PWHEADLESS=0 pnpm e2e:perform:rehearsal

# Just live: cast performs while audience watches; no rehearsal, no replay.
PWHEADLESS=0 pnpm e2e:perform:live

# Just replay: no cast logins. Audience watches the most recent recording.
# Errors clearly if no Performance exists for the stage yet.
PWHEADLESS=0 pnpm e2e:perform:replay

# Arbitrary combos via the env var:
PWHEADLESS=0 E2E_PHASES=live,replay pnpm e2e:perform
PWHEADLESS=0 E2E_PHASES=rehearsal,replay pnpm e2e:perform

# Smoke beats still works on top of any phase selection:
PWHEADLESS=0 E2E_PHASES=live E2E_BEATS=smoke pnpm e2e:perform
```

`E2E_REPLAY` still works as a fallback default when `E2E_PHASES` is unset.

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
