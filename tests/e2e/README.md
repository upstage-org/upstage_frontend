# UpStage End-to-End Tests (Playwright)

These tests drive the real UpStage SPA against a live Studio GraphQL API and
Mosquitto. The main flow authors a Romeo and Juliet Act I Scene I stage as
`admin`, then runs the play with thirteen player browser contexts plus an
admin observer so chats and board actions round-trip through MQTT.

**The suite writes into its own disposable backend** — a fresh `upstage_e2e`
postgres database plus an `upstage_backend_e2e` API container on
`127.0.0.1:9092` — never into the shared dev DB (`global-setup` refuses the
known shared endpoints unless `E2E_ALLOW_SHARED_DB=1`; running against dev
once assigned e2e media to a real user's account). Standard flow:

```sh
tests/e2e/env/e2e-backend-up.sh     # fresh DB + API :9092 (migrations seed admin)
tests/e2e/env/vite-e2e.sh           # SPA on :3001 pointed at :9092
E2E_SKIP_CONFIRM=1 PWHEADLESS=1 pnpm e2e
tests/e2e/env/e2e-backend-down.sh   # dispose (drops the DB; --purge removes uploads too)
```

Personas are self-seeding: `global-setup` batch-creates any missing player
accounts through the admin API, and `setup.spec.ts` authors the stage/media,
so a fresh DB needs no manual preparation.

Configuration and secrets are merged into `process.env` from **`upstage_frontend/.env.test`**
(copy from **`.env.test.example`** on first setup).
The authoritative defaults and summaries live in **`tests/e2e/e2e-config.ts`**
(`loadE2eConfig()`, `formatE2eConfigSummary()`). `tests/e2e/e2e-env-bootstrap.ts`
runs first in Playwright and GraphQL entrypoints so `.env.test` is found whether
the importing file lives in the package root or under `tests/e2e/`.

## Preflight (local runs)

`pnpm e2e`, `pnpm e2e:setup`, `pnpm e2e:perform`, `pnpm e2e:smoke`, and `pnpm e2e:smoke:stub`
are routed through **`tests/e2e/run-e2e.ts`**. It prints the resolved settings and prompts:

`Proceed with Playwright using the settings above? [y/N]`

Skipping the prompt automatically when **any** of these hold:

- `CI` is set (GitHub Actions, etc.)
- `E2E_SKIP_CONFIRM=1`
- stdin / stdout are not a TTY (piped CI without `CI`; it proceeds with a console note)

Running **`pnpm exec playwright test`** directly bypasses preflight entirely.

## What you need running

1. **Studio / backend** reachable at the URL in `E2E_GRAPHQL_ENDPOINT`.
   `.env.test.example` sets the disposable backend,
   `http://127.0.0.1:9092/api/studio_graphql`; the fallback in
   `e2e-config.ts` when the variable is unset is
   `http://127.0.0.1:3001/api/studio_graphql` (through the Vite proxy). Keep
   the same DB between runs if you want `runtime.json` reuse to work.

2. **Frontend** already serving the SPA at **`E2E_BASE_URL`**, or leave it unset to target **`http://127.0.0.1:3000`** (typical `pnpm dev`). Playwright **never** starts the dev server—bring the bundle up yourself first.

   The bundle must expose `window.__UPSTAGE_PINIA__` so the e2e helpers in `perform.spec.ts` / `features.spec.ts` / `pages/LiveStagePage.ts` can call stage-store methods (e.g. `__UPSTAGE_PINIA__.stage.placeObjectOnStage(...)`) on each player's seat. Two ways to satisfy this:
   - `pnpm dev` — automatic via `import.meta.env.DEV` (see `src/main.ts`).
   - `vite build` via `run_front_end_dev.sh` — the build must see `VITE_E2E=1`. The dev script exports it and compose passes it on as a build arg (`ENV VITE_E2E` in the inline Dockerfile). The other `VITE_*` values (`VITE_MQTT_ENDPOINT`, `VITE_GRAPHQL_ENDPOINT`, `VITE_STATIC_ASSETS_ENDPOINT`, …) come from `env_backup_dev`, which the script copies to `./.env` for the build; without them MQTT silently no-ops and asset URLs 404. The templates (`env.template`, `dotenv_template`, `.env.example`) carry `VITE_E2E=1`.
   - **Production builds never get the hook.** `run_front_end_prod.sh` deliberately does not set `VITE_E2E`, because the hook exposes the auth store and its tokens. Do not add it to `env_backup_prod`.

   Earlier builds installed `window.__UPSTAGE_STORE__` (a Vuex stage
   facade). That hook and the `vuex` dependency itself were removed in
   Phase 5.3 Wave F. If you're rebasing a branch onto a tree that still
   uses `__UPSTAGE_STORE__` the rewrite is mechanical: `store.dispatch
("stage/X", p)` → `__UPSTAGE_PINIA__.stage.X(p)`, `store.state.stage.X`
   → `__UPSTAGE_PINIA__.stage.X`, `store.getters["stage/X"]` →
   `__UPSTAGE_PINIA__.stage.X`. All stores (`auth`, `cache`, `config`,
   `user`, `stage`) are exposed via `__UPSTAGE_PINIA__`.

   **Heads-up:** `.dockerignore` deliberately includes `.env` in the build context (see comment in that file). If you re-add `.env` to `.dockerignore` you'll break `vite build` for **all** `VITE_*` vars, not just `VITE_E2E`.

3. **Mosquitto** for perform tests. The SPA connects over **WebSockets** (see
   `VITE_MQTT_ENDPOINT`, typically `ws://localhost:9001` on the host). Plain
   **MQTT TCP 1883** is usually mapped only **inside** Docker. `global-setup.ts`
   probes `E2E_MQTT_HOST` / **`E2E_MQTT_PORT`** (defaults to localhost / **9001**);
   failures are warned, not fatal, but chat/avatar beats need the broker reachable
   where the browser points.

4. **Asset PNGs** (first time or after wiping `tests/e2e/assets`):

   ```bash
   pnpm e2e:assets
   ```

   Output is under `tests/e2e/assets/{portraits,backdrops,props}` and is
   committed so CI does not need `@napi-rs/canvas`.

## Persisted run state (`runtime.json`)

Path: `tests/e2e/runtime.json` (gitignored).

The setup spec writes a handoff blob that `perform.spec.ts` reads: stage id
and slug, media ids for each persona and prop/backdrop keys, and an admin JWT
snapshot. Newer files also include `schemaVersion`, `graphqlEndpoint`, and
`lastValidatedAt` when applicable.

**Reuse (default for local runs)**

- **`global-setup.ts`** — After creating any missing cast accounts, if
  `E2E_RUN_ID` is not set and `E2E_FORCE_FRESH_SETUP` is off, loads
  `runtime.json` and validates it against Studio (same stage, live status, all
  expected media on the stage, matching `graphqlEndpoint` when stored). On
  success it exports the **same `runId`** so media naming and slug stay aligned
  with what is already on the server.
- **`setup.spec.ts`** — If the file validates, skips authoring: signs in via the
  UI, opens the live stage, refreshes `adminToken` and `lastValidatedAt`, and
  exits. Otherwise it performs full (or incremental) authoring: uploads are
  skipped when a row already exists for the planned name; an existing stage for
  the planned `fileLocation` is reused instead of creating a duplicate.

**Start clean**

```bash
E2E_FORCE_FRESH_SETUP=1 pnpm e2e:setup
```

That removes `runtime.json` and forces new authoring; global-setup skips
reuse of `runId` from disk as well.

**Explicit run id**

If you set **`E2E_RUN_ID`** yourself, global-setup **does not** overwrite it.

## Accounts and passwords

Cast accounts are defined in `personas/index.ts`. **`global-setup.ts`** calls
Studio’s batch user creation **idempotently** (existing usernames are skipped).

| Role        | Source                                                               |
| ----------- | -------------------------------------------------------------------- |
| Admin       | `E2E_ADMIN_USERNAME` / `E2E_ADMIN_PASSWORD`                          |
| All players | `E2E_PLAYER_PASSWORD` plus per-persona emails in `personas/index.ts` |

Set all three in `.env.test`. The fallbacks in `e2e-config.ts` (`admin` /
`12345678`, players `e2e-pw`) do not work against the disposable backend: its
migrations seed the admin as `admin` / `Secret@123`, and the backend rejects
passwords shorter than 8 characters.

Passwords are not stored in `runtime.json`; they stay in code and env.

## Commands (from `upstage_frontend`)

| Command                                                | Purpose                                                                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `pnpm e2e`                                             | Full suite (`run-e2e` preflight → every Playwright project in the table below).                            |
| `pnpm e2e:setup`                                       | Setup project only (`run-e2e` preflight → `playwright test --project=setup`).                              |
| `pnpm e2e:perform`                                     | Perform project (`run-e2e` preflight → `playwright --project=perform`; setup runs first via dependencies). |
| `pnpm e2e:features`                                    | Features project (drawing, drawing-as-avatar, opacity, depth; setup runs first via dependencies).          |
| `pnpm e2e:smoke`                                       | Short perform slice via `E2E_BEATS=smoke` + `run-e2e` preflight.                                           |
| `pnpm e2e:smoke:stub`                                  | Mock smoke specs only + `run-e2e` preflight.                                                               |
| `pnpm e2e:replay-studio`                               | Studio Archive → replay viewer (`replay-studio.spec.ts`; needs setup + archived performance).              |
| `pnpm e2e:perform:replay`                              | Perform pass 3 only (`E2E_PHASES=replay`).                                                                 |
| `pnpm e2e:perform:rehearsal` / `pnpm e2e:perform:live` | Perform pass 1 or pass 2 only (`E2E_PHASES=rehearsal` / `live`).                                           |
| `pnpm e2e:webkit`                                      | `stage.spec.ts` on Playwright's Desktop Safari.                                                            |

`realtime`, `upload-limit` and `streaming` have no script of their own; run
them with `pnpm exec tsx ./tests/e2e/run-e2e.ts test --project=<name>`.

## Environment variables

| Variable                                   | Meaning                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_BASE_URL`                             | SPA origin (**must be listening already**). Unset ⇒ default `http://127.0.0.1:3000`; Playwright never spawns Vite.                                                  |
| `E2E_GRAPHQL_ENDPOINT`                     | Studio GraphQL URL for Node helpers (`graphql.ts`, setup, global-setup).                                                                                            |
| `E2E_MQTT_HOST`, `E2E_MQTT_PORT`           | TCP probe for the WS listener on the host (defaults `localhost` / **`9001`**). Use the same port your `ws://…` MQTT URL exposes; **1883** is internal MQTT, not WS. |
| `E2E_ADMIN_USERNAME`, `E2E_ADMIN_PASSWORD` | Admin login for harness and SPA.                                                                                                                                    |
| `E2E_PLAYER_PASSWORD`                      | Password for every persona row created by batch user creation.                                                                                                      |
| `E2E_RUN_ID`                               | Fixed authoring id prefix; disables automatic `runId` generation from timestamp/PID when set.                                                                       |
| `E2E_FORCE_FRESH_SETUP`                    | Non-false ⇒ drop `runtime.json`, ignore persisted stage reuse (see above).                                                                                          |
| `E2E_BEATS`                                | Set to `smoke` for the short perform slice (`e2e:smoke`).                                                                                                           |
| `E2E_SKIP_CONFIRM`                         | Set to `1` to skip the interactive “proceed?” step in `run-e2e.ts`.                                                                                                 |
| `PWHEADLESS`                               | `1`/`0`/`false` overrides headed vs headless (CI defaults headless via `CI=1`).                                                                                     |
| `E2E_PHASES`                               | Comma-separated perform passes to run: `rehearsal`, `live`, `replay`.                                                                                               |
| `E2E_PACE`                                 | `fast`, `normal` or `slow` pacing of the perform beats.                                                                                                             |
| `E2E_REPLAY`                               | `1`/`0`: default for the replay pass when `E2E_PHASES` is unset.                                                                                                    |
| `E2E_CAPTCHA_TOKEN`                        | Optional Turnstile token for the Node-side login in global-setup; only needed when the SPA runs with `VITE_ENV_TYPE=Production`.                                    |
| `E2E_ALLOW_SHARED_DB`                      | `1` lets the suite write into a shared backend (port 9090, `dev.upstage.live`, `upstage.live`). global-setup refuses those otherwise.                               |
| `E2E_EVENT_ARCHIVE`                        | `1` when an event-archive worker stores the e2e stage events in the e2e database; enables the replay-dependent streaming test.                                      |
| `E2E_MQTT_NAMESPACE`                       | MQTT namespace of the SPA under test (default `dev`).                                                                                                               |
| `JITSI_E2E_LIVE`                           | `1` runs the two `@live` streaming tests, which need a reachable Jitsi server and bridge. They are skipped otherwise.                                               |

## Playwright projects

| Project         | Files                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `smoke`         | `auth.spec.ts`, `media.spec.ts`, `stage.spec.ts`                                                                  |
| `setup`         | `setup.spec.ts`                                                                                                   |
| `perform`       | `perform.spec.ts` (runs after `setup` in one invocation)                                                          |
| `features`      | `features.spec.ts` — drawing, drawing-as-avatar, opacity, depth (runs after `setup`)                              |
| `replay-studio` | `replay-studio.spec.ts` — Studio Archive tab opens `/replay/:slug/:id` (runs after `setup`)                       |
| `realtime`      | `realtime.spec.ts` — live drag positions and backdrop fade (runs after `setup`)                                   |
| `upload-limit`  | `upload-limit.spec.ts` — per-user upload caps through the real dropzone                                           |
| `streaming`     | `streaming.spec.ts` — performer streams, audience views; Chromium fake camera and microphone (runs after `setup`) |
| `webkit`        | `stage.spec.ts` on Desktop Safari                                                                                 |

### Streaming project

The streaming tests run in serial mode, so the first failure stops the rest
of the file. To run only the two tests that use a real Jitsi server:

```sh
JITSI_E2E_LIVE=1 pnpm exec playwright test --project=streaming -g "@live"
```

The disposable backend has no event-archive worker, so nothing a test puts on
the board is stored in its `events` table, and every test starts with an empty
board. The one test that needs a reloaded stage to be replayed ("persisted
jitsi tile re-publishes after performer navigates away/back") is skipped
unless `E2E_EVENT_ARCHIVE=1` says an archive worker is running for the e2e
database. Running one is not enough to enable it for the whole suite: the
other tests rely on the empty board and do not clean up after themselves.

The e2e SPA uses the `dev` MQTT namespace (the dev broker's ACL allows the
stage login `dev/+/+` only), and the dev archive worker subscribes to every
topic. So e2e stage events ARE stored, in the dev database.

## Directory layout

```
tests/e2e/
├── README.md                 ← this file
├── e2e-config.ts              resolved env + `formatE2eConfigSummary`
├── e2e-env-bootstrap.ts       loads `.env.test` before other e2e imports
├── run-e2e.ts                 preflight + `pnpm exec playwright …`
├── personas/index.ts          cast + admin helpers
├── script/
│   └── romeo-and-juliet-a1s1.ts
├── pages/                     Login, MediaLibrary, StageManagement, LiveStage
├── fixtures/
│   ├── runtime.ts             read/write runtime.json
│   ├── validate-runtime.ts   GraphQL validation for reuse
│   └── e2e-env.ts            E2E_FORCE_FRESH_SETUP helper
├── assets/                    deterministic PNG inputs (+ generate.mjs)
├── graphql.ts                 fetch-based GraphQL client for Node
├── global-setup.ts            probes, batch users, optional runId reuse
├── setup.spec.ts              authoring (+ fast path when runtime validates)
├── perform.spec.ts           multi-context MQTT play
├── auth.spec.ts
├── media.spec.ts
├── stage.spec.ts
├── features.spec.ts          drawing / drawing-as-avatar / opacity / depth
├── realtime.spec.ts
├── replay-studio.spec.ts
├── streaming.spec.ts
├── upload-limit.spec.ts
├── env/                      e2e-backend-up.sh, e2e-backend-down.sh, vite-e2e.sh
├── scripts/                  one-off probe scripts (`*.mjs`), not part of the suite
│   ├── editor/               rich text editor on the admin pages: `node tests/e2e/scripts/editor/rich-text-editor-check.cjs`
│   └── reauth/               login ending on a live stage: `node tests/e2e/scripts/reauth/reauth-on-stage-check.cjs`
└── runtime.json               emitted by setup; gitignored
```

## Why perform is flakier than setup

Perform asserts end-to-end over MQTT (e.g. chat lines visible across contexts).
Retries are enabled in CI (`playwright.config.ts`). If timings fail locally,
ensure Mosquitto and Studio latency are stable and consider `pnpm e2e:smoke` or
narrowing beats via `E2E_BEATS=smoke`.

## Out of scope

- Real cameras, microphones and OBS encoders (the streaming project uses Chromium's fake devices)
- Mobile viewports
- Locales other than English for these specs
