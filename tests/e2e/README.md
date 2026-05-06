# UpStage End-to-End Tests (Playwright)

These tests drive the real UpStage SPA against a live Studio GraphQL API and
Mosquitto. The main flow authors a Romeo and Juliet Act I Scene I stage as
`admin`, then runs the play with thirteen player browser contexts plus an
admin observer so chats and board actions round-trip through MQTT.

Configuration and secrets are merged into `process.env` from **`upstage_frontend/.env.test`**.
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

1. **Studio / backend** reachable at the URL in `E2E_GRAPHQL_ENDPOINT`
   (default `http://127.0.0.1:3001/api/studio_graphql`). A typical dev stack is
   started from the backend repo’s docker compose scripts; keep the same DB
   between runs if you want `runtime.json` reuse to work.

2. **Frontend** already serving the SPA at **`E2E_BASE_URL`**, or leave it unset to target **`http://127.0.0.1:3000`** (typical `pnpm dev`). Playwright **never** starts the dev server—bring the bundle up yourself first.

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

| Role | Source |
|------|--------|
| Admin | `E2E_ADMIN_USERNAME` / `E2E_ADMIN_PASSWORD` (defaults `admin` / `12345678`) |
| All players | `E2E_PLAYER_PASSWORD` (default `e2e-pw`) plus per-persona emails in `personas/index.ts` |

Passwords are not stored in `runtime.json`; they stay in code and env.

## Commands (from `upstage_frontend`)

| Command | Purpose |
|---------|---------|
| `pnpm e2e` | Full suite (`run-e2e` preflight → Playwright lists all projects: smoke + setup + perform). |
| `pnpm e2e:setup` | Setup project only (`run-e2e` preflight → `playwright test --project=setup`). |
| `pnpm e2e:perform` | Perform project (`run-e2e` preflight → `playwright --project=perform`; setup runs first via dependencies). |
| `pnpm e2e:smoke` | Short perform slice via `E2E_BEATS=smoke` + `run-e2e` preflight. |
| `pnpm e2e:smoke:stub` | Mock smoke specs only + `run-e2e` preflight. |

## Environment variables

| Variable | Meaning |
|----------|---------|
| `E2E_BASE_URL` | SPA origin (**must be listening already**). Unset ⇒ default `http://127.0.0.1:3000`; Playwright never spawns Vite. |
| `E2E_GRAPHQL_ENDPOINT` | Studio GraphQL URL for Node helpers (`graphql.ts`, setup, global-setup). |
| `E2E_MQTT_HOST`, `E2E_MQTT_PORT` | TCP probe for the WS listener on the host (defaults `localhost` / **`9001`**). Use the same port your `ws://…` MQTT URL exposes; **1883** is internal MQTT, not WS. |
| `E2E_ADMIN_USERNAME`, `E2E_ADMIN_PASSWORD` | Admin login for harness and SPA. |
| `E2E_PLAYER_PASSWORD` | Password for every persona row created by batch user creation. |
| `E2E_RUN_ID` | Fixed authoring id prefix; disables automatic `runId` generation from timestamp/PID when set. |
| `E2E_FORCE_FRESH_SETUP` | Non-false ⇒ drop `runtime.json`, ignore persisted stage reuse (see above). |
| `E2E_BEATS` | Set to `smoke` for the short perform slice (`e2e:smoke`). |
| `E2E_SKIP_CONFIRM` | Set to `1` to skip the interactive “proceed?” step in `run-e2e.ts`. |
| `PWHEADLESS` | `1`/`0`/`false` overrides headed vs headless (CI defaults headless via `CI=1`). |

## Playwright projects

| Project | Files |
|---------|-------|
| `smoke` | `auth.spec.ts`, `media.spec.ts`, `stage.spec.ts` |
| `setup` | `setup.spec.ts` |
| `perform` | `perform.spec.ts` (runs after `setup` in one invocation) |

`workers: 1` and `fullyParallel: false` keep ordering predictable for setup and MQTT.

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
└── runtime.json               emitted by setup; gitignored
```

## Why perform is flakier than setup

Perform asserts end-to-end over MQTT (e.g. chat lines visible across contexts).
Retries are enabled in CI (`playwright.config.ts`). If timings fail locally,
ensure Mosquitto and Studio latency are stable and consider `pnpm e2e:smoke` or
narrowing beats via `E2E_BEATS=smoke`.

## Out of scope

- Driving Jitsi beyond basic presence checks where applicable  
- Replay / recording workflows  
- Mobile viewports  
- Locales other than English for these specs  
