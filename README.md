# UpStage Frontend

The Vue 3 single-page app ("studio") for UpStage players and audience. It
talks GraphQL to the [backend](../upstage_backend) at `/api/studio_graphql`,
receives live-stage traffic over MQTT WebSockets, and is deployed as a static
`dist/` bundle served by host nginx.

**Toolchain:** Node `>=26 <27` (`.nvmrc` says 26) and pnpm `>=10`
(`packageManager: pnpm@12.6.0`; Node 25+ no longer bundles corepack, so
`npm install -g corepack && corepack enable` gives you the right one).

---

## Running for development

```sh
pnpm install
cp .env.example .env      # then edit — see the sample below; add LOCAL_SERVE_STATIC_CONTENT
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
# Streaming servers: one or more URLs each; several URLs are comma-separated
# (see "Multi-server streaming"). The first URL is the default server.
VITE_JITSI_ENDPOINTS=https://streaming.example.org
VITE_RTMP_ENDPOINTS=https://streaming2.example.org
# VITE_JITSI_ENDPOINTS=https://streaming.example.org,https://streaming3.example.org
# VITE_RTMP_ENDPOINTS=https://streaming2.example.org,https://streaming4.example.org
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

| Variable                                                                                                                 | Purpose                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_GRAPHQL_ENDPOINT`                                                                                                  | Backend API base URL (with trailing slash). Falls back to `window.location.origin + /api/`.                                                                                                                                                      |
| `VITE_STATIC_ASSETS_ENDPOINT`                                                                                            | Uploaded-media URL prefix (default `/resources/`).                                                                                                                                                                                               |
| `VITE_MQTT_NAMESPACE`                                                                                                    | MQTT topic prefix (must match the stage namespace, e.g. `dev`).                                                                                                                                                                                  |
| `VITE_MQTT_ENDPOINT`                                                                                                     | MQTT **WebSocket** URL (`ws://…:9001` in dev, `wss://…:443` in prod).                                                                                                                                                                            |
| _(no broker credential vars)_                                                                                            | The Mosquitto `performance` login is served at runtime on the GraphQL `Stage.mqtt` field so it never reaches the public bundle. Set `MQTT_USER` / `MQTT_PASSWORD` on the **backend**.                                                            |
| `VITE_JITSI_ENDPOINTS`                                                                                                   | Jitsi server URL(s) for camera/mic streaming: **one or more origins, comma-separated when there are several**. The first URL is the default; with 2+ URLs performers pick a server in the Streams tab.                                           |
| `VITE_JITSI_XMPP_DOMAIN` / `VITE_JITSI_XMPP_MUC_DOMAIN` / `VITE_JITSI_XMPP_FOCUS_DOMAIN` / `VITE_JITSI_PREFER_WEBSOCKET` | Optional Jitsi XMPP overrides for non-default Jitsi installs. The three domain overrides apply to the default (first) server only.                                                                                                               |
| `VITE_JITSI_WIRE_TRACE`                                                                                                  | `true` logs the XMPP wire trace (`[diag]`) to the console. Only honoured by the dev server, never by a built bundle.                                                                                                                             |
| `VITE_RTMP_ENDPOINTS`                                                                                                    | MediaMTX playback URL(s) for RTMP/OBS stream feeds: **one or more origins, comma-separated when there are several**. The first URL is the default; a stream feed is bound to one server when it is created. **Leave unset to hide all RTMP UI.** |
| `VITE_CLOUDFLARE_CAPTCHA_SITEKEY`                                                                                        | Turnstile site key for the login captcha.                                                                                                                                                                                                        |
| `VITE_STRIPE_KEY`                                                                                                        | Stripe publishable key (donations/subscriptions; optional).                                                                                                                                                                                      |
| `VITE_RELEASE_VERSION` / `VITE_ALIAS_RELEASE_VERSION`                                                                    | Version strings shown in the UI.                                                                                                                                                                                                                 |
| `VITE_ENV_TYPE`                                                                                                          | `Production` (exact spelling) shows the Turnstile captcha on login, registration and the donation form; anything else hides it. CORS is a backend setting (`ENV_TYPE`), not this one.                                                            |
| `VITE_E2E`                                                                                                               | Exposes every store, including the login tokens, on `window.__UPSTAGE_PINIA__` for Playwright (also on in `pnpm dev`). `run_front_end_dev.sh` sets it; **never set it for a production build**.                                                  |
| `LOCAL_SERVE_STATIC_CONTENT`                                                                                             | Dev/test only (not `VITE_`-prefixed): uploads dir for the dev static server.                                                                                                                                                                     |
| `VITE_STUDIO_API_PROXY`                                                                                                  | Dev only: override the `/api` proxy target (default `http://127.0.0.1:9090`).                                                                                                                                                                    |
| `FRONTEND_PORT`                                                                                                          | Port for `pnpm serve:dist` preview (default 4173).                                                                                                                                                                                               |

---

### Multi-server streaming

One performance can be spread over several Jitsi and several MediaMTX (RTMP)
servers. The frontend build is the only place the list of servers lives:

```sh
# one or more URLs per variable, comma-separated; the first is the default
VITE_JITSI_ENDPOINTS=https://streaming.example.org,https://streaming3.example.org
VITE_RTMP_ENDPOINTS=https://streaming2.example.org,https://streaming4.example.org
```

Rules: each variable holds one or more URLs, comma-separated; the first URL is
the default server; the list is de-duplicated in the order given; entries that
are not bare `http(s)://host[:port]` origins are dropped. These plural variables
are the only ones read: the pre-2026-09 singular `VITE_JITSI_ENDPOINT` /
`VITE_RTMP_ENDPOINT` are ignored, so migrate any old `.env` before building.
The console logs
`[config] streaming servers: N Jitsi, M RTMP` at startup. Everything below is
enabled only when a list has two or more entries — single-server builds are
byte-for-byte unchanged.

What players get with 2+ entries:

- **RTMP** — Studio > Media > "New RTMP stream feed" shows a "Streaming server"
  dropdown. The choice is stored on the feed (`description.rtmpEndpoint` via the
  `rtmpEndpoint` field of `saveMedia`) and fixes both the OBS ingest URL shown in
  "Stream info" and every viewer's WHEP/HLS playback origin. Feeds created before
  the list existed keep using the default server.
- **Jitsi** — Stage Management > Customisation gets a "Video streaming server"
  default for the stage plus a "Configured servers: N Jitsi, M RTMP" line; on
  stage, the Streams tab shows a server select under the performer's own tile
  (switching mid-show asks for confirmation and drops the tile for a few
  seconds); "Create Meeting" gets a "Streaming server" dropdown. Audience
  browsers connect automatically to every Jitsi server that has a tile on the
  board.

Server side, each extra MediaMTX host needs the same `STREAM_KEY`-signed auth
check as the first one; it calls back to the backend host's public
`/api/rtmp/auth?k=<secret>` endpoint. Bring-up steps live in
`/root/streaming2/README.md` ("Additional MediaMTX servers") and
`../MULTI_SERVER_NEXT_STEPS_2026-09-10.md` on the dev host.

## Building & deploying

Each site keeps a gitignored `env_backup_<site>` file (same format as `.env`
above). The run scripts copy it into place and build:

```sh
./run_front_end_dev.sh --build     # or run_front_end_prod.sh
```

`--build` runs a one-shot docker compose builder (Node 26 + pnpm, typecheck +
`vite build`) and writes the result to **`/frontend_app_<site>/dist`** on the
host. The dev site is built with `pnpm build:dev` (Vite mode `development`),
prod with `pnpm build`. The image is rebuilt without cache on every run.
Nothing in this repo serves production traffic — that's nginx's job.

Every build writes a stamp to `public/version.json` and bakes the same value
into the bundle. The stamp is the UTC deploy time (`UPSTAGE_BUILD_VERSION`,
set by the run scripts; no git access). An open page compares its own stamp
with the served `/version.json` (fetched with `cache: "no-store"`) and
offers a reload when they differ.

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

The vendored scripts under `public/js/` (`jitsi/lib-jitsi-meet.min.js`,
`mespeak/`) ship inside `dist/` — deploy the whole directory.
`lib-jitsi-meet` must stay compatible with the Jitsi server release. The
current copy is the one Jitsi `stable-11248` ships (version `7d14f385`), with
one local change: room metadata is passed to the STUN/TURN handler only when
its `services` field is a list. Prosody sends `"services":{}` when no TURN
server is configured, which the unchanged library reports as
`findAll error: :scope>services>service` on every join. Re-apply that change
when the file is replaced (search for `onReceiveStunAndTurnCredentials(i)`).

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
- **Login lifetime.** The backend issues tokens that last 30 days for admins
  and 2 days for everyone else (`JWT_ADMIN_TOKEN_DAYS` / `JWT_USER_TOKEN_DAYS`
  on the backend). An open page renews its tokens five minutes before they
  expire, so an active user stays logged in.
- **When a login ends.** If the server refuses to renew, the session is
  cleared and the browser goes to `/login?redirect=<page>`; the login page
  shows a "session expired" notice and returns the user to that page after
  login. If the server cannot be reached, the user stays logged in and the
  renewal is retried every 30 seconds.
- **A login that ends during a performance.** Only players log in; the
  audience watches without an account. While a stage or a popped-out chat
  window is open, a login that ends never interrupts the player: nothing is
  cleared, the page does not navigate, and the stage keeps running over its
  broker connection.
  - The player is asked to log in again in a small panel on the stage
    (`views/live/ReauthPrompt.vue`). It has no backdrop and takes no focus.
    Logging in puts the new tokens into the running session; only the same
    account is accepted.
  - A request that needs the login waits for that and is then sent again
    with the new token (`replayAfterReauth` in `apollo.ts`).
  - "Later" closes the panel and leaves a "Log in again" button. Waiting
    requests then fail with "Your login has expired". The logout completes
    when the player leaves the stage, and the login page returns them to the
    page they were going to.
  - A stage page that is _loaded_ with an already expired login goes to the
    login page first and comes back to the stage: nothing is running yet.
  - The player's own Logout is never deferred.
- **Several windows on one login.** The stage, a popped-out chat and the
  studio share the stored login. A window takes over tokens that another
  window renewed or logged in with, so logging in again once restores every
  window, and two windows renewing at the same moment do not end the login
  (the backend rotates the refresh token, so one of them is refused).
- More docs: [docs/REPLAY.md](docs/REPLAY.md) (recordings & replay),
  [docs/STREAM_AUDIO.md](docs/STREAM_AUDIO.md) (who hears a stream),
  [docs/BROWSER_SUPPORT.md](docs/BROWSER_SUPPORT.md),
  [TOUCH_CHEATSHEET.md](TOUCH_CHEATSHEET.md) (touch-screen controls).

## License

GPL-3.0 (see [LICENSE](LICENSE)).
