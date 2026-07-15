# UpStage Frontend

The Vue 3 single-page app ("studio") for UpStage players and audience. It
talks GraphQL to the [backend](../upstage_backend) at `/api/studio_graphql`,
receives live-stage traffic over MQTT WebSockets, and is deployed as a static
`dist/` bundle served by host nginx.

**Toolchain:** Node `>=22 <23` (`.nvmrc` says 22) and pnpm `>=10`
(`packageManager: pnpm@11.1.2`; `corepack enable` gives you the right one).

---

## Running for development

```sh
pnpm install
cp .env.example .env      # then edit — see the sample below
pnpm dev                  # Vite on http://localhost:3000
```

Two things the dev server needs:

- **`LOCAL_SERVE_STATIC_CONTENT`** must point at an uploads directory on
  disk (e.g. `/app_code_dev/uploads`). In development there is no nginx to
  serve `/resources/`, so Vite serves it; **`pnpm dev` refuses to start
  without this variable.**
- **A backend.** The dev server proxies `/api` → `http://127.0.0.1:9090`
  (the dev backend's host port); override with `VITE_STUDIO_API_PROXY`.
  Point `VITE_GRAPHQL_ENDPOINT` at the _frontend's own_ origin (e.g.
  `http://localhost:3000/api/`) so requests go through the proxy.

### Sample `.env`

Copied from a working dev instance with secret-like values X'd out:

```sh
VITE_GRAPHQL_ENDPOINT=https://dev.example.org/api/
VITE_STATIC_ASSETS_ENDPOINT=/resources/
VITE_MQTT_NAMESPACE=dev
VITE_MQTT_ENDPOINT=wss://mqtt-dev.example.org:443
VITE_MQTT_USERNAME=performance
VITE_MQTT_PASSWORD=XXXXXXXXXXXXX
VITE_JITSI_ENDPOINT=https://streaming.example.org
VITE_RTMP_ENDPOINT=https://streaming2.example.org
VITE_CLOUDFLARE_CAPTCHA_SITEKEY=XXXXXXXXXXXXXXXXXXXXXXX
VITE_STRIPE_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_RELEASE_VERSION='3.1.0'
VITE_ALIAS_RELEASE_VERSION='Build 001'
VITE_ENV_TYPE=Dev
# LOCAL_SERVE_STATIC_CONTENT — local dev and vitest only (not production).
# Lets the Vite dev server serve uploaded media from disk; omit in prod deploys.
LOCAL_SERVE_STATIC_CONTENT=/app_code_dev/uploads
```

### Environment variables

All runtime config is baked in at build time (`import.meta.env`), consumed
centrally in `src/config.ts` (types in `src/env.d.ts`):

| Variable                                                                                                                 | Purpose                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `VITE_GRAPHQL_ENDPOINT`                                                                                                  | Backend API base URL (with trailing slash). Falls back to `window.location.origin + /api/`. |
| `VITE_STATIC_ASSETS_ENDPOINT`                                                                                            | Uploaded-media URL prefix (default `/resources/`).                                          |
| `VITE_MQTT_NAMESPACE`                                                                                                    | MQTT topic prefix (must match the stage namespace, e.g. `dev`).                             |
| `VITE_MQTT_ENDPOINT`                                                                                                     | MQTT **WebSocket** URL (`ws://…:9001` in dev, `wss://…:443` in prod).                       |
| `VITE_MQTT_USERNAME` / `VITE_MQTT_PASSWORD`                                                                              | Broker credentials — must match the backend Mosquitto `performance` user.                   |
| `VITE_JITSI_ENDPOINT`                                                                                                    | Jitsi host origin for camera/mic streaming.                                                 |
| `VITE_JITSI_XMPP_DOMAIN` / `VITE_JITSI_XMPP_MUC_DOMAIN` / `VITE_JITSI_XMPP_FOCUS_DOMAIN` / `VITE_JITSI_PREFER_WEBSOCKET` | Optional Jitsi XMPP overrides for non-default Jitsi installs.                               |
| `VITE_RTMP_ENDPOINT`                                                                                                     | MediaMTX playback origin for RTMP/OBS stream feeds. **Leave unset to hide all RTMP UI.**    |
| `VITE_CLOUDFLARE_CAPTCHA_SITEKEY`                                                                                        | Turnstile site key for the login captcha.                                                   |
| `VITE_STRIPE_KEY`                                                                                                        | Stripe publishable key (donations/subscriptions; optional).                                 |
| `VITE_RELEASE_VERSION` / `VITE_ALIAS_RELEASE_VERSION`                                                                    | Version strings shown in the UI.                                                            |
| `VITE_ENV_TYPE`                                                                                                          | `Production` enables captcha + CORS restrictions; anything else relaxes them.               |
| `VITE_E2E`                                                                                                               | Exposes `window.__UPSTAGE_PINIA__` for Playwright (also on in `pnpm dev`).                  |
| `LOCAL_SERVE_STATIC_CONTENT`                                                                                             | Dev/test only (not `VITE_`-prefixed): uploads dir for the dev static server.                |
| `VITE_STUDIO_API_PROXY`                                                                                                  | Dev only: override the `/api` proxy target (default `http://127.0.0.1:9090`).               |
| `FRONTEND_PORT`                                                                                                          | Port for `pnpm serve:dist` preview (default 4173).                                          |

---

## Building & deploying

Each site keeps a gitignored `env_backup_<site>` file (same format as `.env`
above). The run scripts copy it into place and build:

```sh
./run_front_end_dev.sh --build     # or run_front_end_prod.sh
```

`--build` runs a one-shot docker compose builder (Node 22 + pnpm, typecheck +
`vite build`) and writes the result to **`/frontend_app_<site>/dist`** on the
host. Nothing in this repo serves production traffic — that's nginx's job:

### Serving (nginx) — all SSL is stripped at nginx

TLS terminates at nginx; everything behind it is plain HTTP/WS. The proxy
must:

- serve `/frontend_app_<site>/dist` as the site root, **with an HTML5
  history fallback** (`try_files $uri /index.html`) — the router uses
  `createWebHistory`, so deep links like `/replay/...` 404 without it;
- alias `/resources/` to the backend's uploads dir (`/app_code_<site>/uploads`);
- proxy `/api/` to the backend (`http://127.0.0.1:9090` dev / `:9091` prod);
- proxy the MQTT WebSocket hostname (e.g. `wss://mqtt-dev.example.org:443`)
  to `http://127.0.0.1:9001` (dev) / `:9002` (prod) with WebSocket upgrade
  headers — the browser's MQTT connection is WebSocket-only;
- use HTTPS in production: browsers only allow camera/microphone (Jitsi) on
  secure origins.

The vendored scripts under `public/js/` (`lib-jitsi-meet.min.js`,
`mespeak.js`) ship inside `dist/` — deploy the whole directory.

`./run_front_end_<site>.sh --serve` runs a Vite dev server against that
site's env instead of building (dev :3001 / prod :3002).

---

## Testing & quality

| Task                       | Command                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| Unit tests (vitest, jsdom) | `pnpm test` / `pnpm test:watch`                                          |
| Typecheck                  | `pnpm typecheck`                                                         |
| Lint / format              | `pnpm lint` / `pnpm format`                                              |
| Full local gate (pre-push) | `pnpm verify` (typecheck + test + `pnpm audit`)                          |
| End-to-end (Playwright)    | `pnpm e2e`, `pnpm e2e:features`, `pnpm e2e:perform`, `pnpm e2e:smoke`, … |
| GraphQL codegen            | `pnpm codegen` (schema from `GRAPHQL_SCHEMA_URL` or `./schema.graphql`)  |

The e2e suite is documented in [tests/e2e/README.md](tests/e2e/README.md): it
runs against a **disposable** backend + `upstage_e2e` database on
`127.0.0.1:9092` (`tests/e2e/env/e2e-backend-up.sh`), configured via
`.env.test` (copy from `.env.test.example`). The seeded login is
`admin` / `Secret@123` (created by the backend migrations). Husky hooks and
CI run the same `verify` gate.

---

## Behaviour notes

- **Admin roles don't grant stage controls.** Admin/Super-admin roles gate
  the Studio admin panels only. Player controls on a live stage (the left
  toolbox, player chat) are granted **per stage**: to the stage owner and to
  users on the stage's player/editor access lists, edited in Stage
  Management → General. An admin who is neither the owner nor listed joins
  that stage as audience. This is intentional.
- **Stale logins on a stage.** If a viewer's login token expires while they
  are watching a stage, they keep watching uninterrupted (as audience); the
  app completes the logout when they navigate away from the stage.
- More docs: [docs/REPLAY.md](docs/REPLAY.md) (recordings & replay),
  [docs/BROWSER_SUPPORT.md](docs/BROWSER_SUPPORT.md),
  [TOUCH_CHEATSHEET.md](TOUCH_CHEATSHEET.md) (touch-screen controls),
  [UpstageInternal.md](UpstageInternal.md) (upstage.live-specific settings +
  data restoration).

## License

GPL-3.0 (see [LICENSE](LICENSE)).
