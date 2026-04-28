# UpStage E2E — Romeo & Juliet, Act I, Scene I

This suite drives the real UpStage SPA through a full play: it authors a stage
end-to-end as the seeded `admin` user, then re-enacts Act I, Scene I with one
browser context per speaking part (13 actors total) so every beat round-trips
through GraphQL and MQTT.

> **Status**: integration-grade tests. They expect the dev backend
> (`run_docker_compose_dev.sh` in `prod_copy/upstage_backend/app_containers`)
> and a frontend served behind nginx (see `setup_local_nginx.sh` in the
> frontend root) to be live before you run.

## Prerequisites

1. Backend dev stack up:
   ```bash
   cd prod_copy/upstage_backend/app_containers
   ./run_docker_compose_dev.sh
   ```
2. Frontend bundle built and served by nginx on `127.0.0.1:80`:
   ```bash
   cd prod_copy/upstage_frontend
   pnpm install
   pnpm build
   ./setup_local_nginx.sh   # one-time per machine
   ```
3. Mosquitto running on `127.0.0.1:2087` (already part of the dev stack).
4. First-time-only: regenerate the deterministic asset PNGs:
   ```bash
   pnpm e2e:assets
   ```
   The generator is idempotent — rerun it freely. Output lands in
   `tests/e2e/assets/{portraits,backdrops,props}` and is committed so CI
   doesn't need a working `@napi-rs/canvas`.

## Run modes

| Command                   | What it does                                                                 |
|---------------------------|------------------------------------------------------------------------------|
| `pnpm e2e:setup`          | Authoring run only. Logs in as admin, uploads every persona's avatar plus props/backdrops, creates the stage, grants player access, writes `tests/e2e/runtime.json`. |
| `pnpm e2e:perform`        | Live run. Reads `runtime.json`, opens 13 browser contexts, walks all ~70 beats, screenshots each persona's view. Depends on `e2e:setup`. |
| `pnpm e2e`                | Both, in order.                                                              |
| `pnpm e2e:smoke`          | 5-beat slice (`E2E_BEATS=smoke`) for fast PR feedback. Still requires `e2e:setup` to have run, since the perform project depends on it. |
| `pnpm e2e:smoke:stub`     | The old mock-only smoke pass over `auth.spec.ts`, `media.spec.ts`, `stage.spec.ts`. Doesn't touch the live backend. |

## Useful env vars

All loaded from `prod_copy/upstage_frontend/.env.test`.

- `E2E_BASE_URL` — frontend origin. Defaults to `http://127.0.0.1`.
- `E2E_GRAPHQL_ENDPOINT` — backend GraphQL endpoint nginx proxies to. Default
  `http://127.0.0.1:3001/api/studio_graphql`.
- `E2E_MQTT_HOST`, `E2E_MQTT_PORT` — TCP probe target so we fail loudly if
  Mosquitto is missing.
- `E2E_ADMIN_USERNAME`, `E2E_ADMIN_PASSWORD` — admin seed credentials.
- `E2E_PLAYER_PASSWORD` — every Romeo/Juliet persona uses the same password.
- `E2E_RUN_ID` — set explicitly to re-use an existing setup run; otherwise
  `global-setup.ts` derives one from the wallclock.
- `E2E_BEATS=smoke` — restrict the perform spec to the 5-beat smoke slice.

## Layout

```
tests/e2e/
├── README.md              ← you are here
├── personas/index.ts      ← 13 cast members + admin
├── script/
│   └── romeo-and-juliet-a1s1.ts   ← BEATS + SMOKE_BEATS
├── pages/                 ← page object models (Login, MediaLibrary, StageManagement, LiveStage)
├── fixtures/runtime.ts    ← runtime.json read/write
├── assets/                ← committed deterministic PNGs (portraits/backdrops/props)
│   └── generate.mjs       ← regenerator (`pnpm e2e:assets`)
├── graphql.ts             ← zero-dep GraphQL helper for setup/global-setup
├── global-setup.ts        ← TCP probes + idempotent batch user creation
├── setup.spec.ts          ← admin authoring spec
└── perform.spec.ts        ← 13-context live performance spec
```

## Why is `perform.spec.ts` so much flakier than `setup.spec.ts`?

Because it asserts on round-trips through MQTT. Every chat line is published
by the speaker's context and consumed by the admin's observer context; we
poll for up to 4 s before failing. CI should run perform with `--retries=2`;
setup with `--retries=0`.

## Out of scope

- Jitsi voice. We assert the iframe exists and don't drive it.
- Replay / recording flow.
- Mobile viewports.
- i18n. Tests run in English only.
