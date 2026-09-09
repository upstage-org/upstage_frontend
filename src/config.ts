const {
  VITE_GRAPHQL_ENDPOINT,
  VITE_STATIC_ASSETS_ENDPOINT,
  VITE_CLOUDFLARE_CAPTCHA_SITEKEY,
  VITE_MQTT_NAMESPACE,
  VITE_MQTT_ENDPOINT,
  VITE_JITSI_ENDPOINT,
  VITE_JITSI_ENDPOINTS,
  VITE_RTMP_ENDPOINT,
  VITE_RTMP_ENDPOINTS,
  VITE_STRIPE_KEY,
  VITE_RELEASE_VERSION,
  VITE_ALIAS_RELEASE_VERSION,
} = import.meta.env;

// Fallback when env was not set at build time (e.g. wrong .env path or CI build)
const ensureTrailingSlash = (url: string) => (url.endsWith("/") ? url : `${url}/`);

/**
 * Source of truth is the `.env`'s `VITE_GRAPHQL_ENDPOINT` (or the matching
 * env_backup_<site> file copied into `.env` by run_front_end_*.sh). The SPA
 * makes whichever absolute origin/path is configured there — same-origin
 * (e.g. `/api/` behind a reverse proxy on remote) or cross-origin
 * (e.g. `http://localhost:9090/api/` when running `--serve` against a
 * backend container that publishes APP_PORT on the host). Backend CORS in
 * dev is `*` (see upstage_backend/main.py), so cross-origin POSTs work.
 *
 * If the env var is not set at build time (wrong .env path, CI build with
 * no env, etc.) we fall back to same-origin `/api/` so the page at least
 * tries something deterministic.
 */
const graphqlEndpoint =
  typeof VITE_GRAPHQL_ENDPOINT === "string" && VITE_GRAPHQL_ENDPOINT
    ? ensureTrailingSlash(VITE_GRAPHQL_ENDPOINT)
    : ensureTrailingSlash(`${window.location.origin}/api/`);
const staticAssetsEndpoint =
  typeof VITE_STATIC_ASSETS_ENDPOINT === "string" && VITE_STATIC_ASSETS_ENDPOINT
    ? ensureTrailingSlash(VITE_STATIC_ASSETS_ENDPOINT)
    : ensureTrailingSlash(`${window.location.origin}/resources/`);

/**
 * Normalise one streaming-server origin from `.env`: trimmed, trailing
 * slashes stripped, must be an absolute http(s) URL with no path/query
 * (the origin is used as a stable server *id* on board objects and stream
 * feed assets, so two spellings of one server must collapse to one value).
 * Returns `null` for anything unusable.
 */
export const normaliseEndpointOrigin = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return trimmed;
  } catch {
    return null;
  }
};

/**
 * Build the ordered, de-duplicated server list for one streaming kind from
 * the legacy singular env var plus the optional comma-separated plural one
 * (`VITE_JITSI_ENDPOINTS` / `VITE_RTMP_ENDPOINTS`). The singular value is
 * always entry 0 so existing single-server installs keep today's default;
 * malformed entries are dropped (and reported once) rather than failing
 * the boot.
 */
export const parseEndpointList = (singular: unknown, plural: unknown): string[] => {
  const out: string[] = [];
  const push = (raw: unknown) => {
    const origin = normaliseEndpointOrigin(raw);
    if (origin && !out.includes(origin)) out.push(origin);
  };
  if (typeof singular === "string" && singular.trim()) {
    // Keep the legacy value byte-for-byte (only a single trailing "/" was
    // ever stripped) so `configs.JITSI_ENDPOINT` / `RTMP_ENDPOINT` do not
    // change for single-server installs.
    const legacy = singular.replace(/\/$/, "");
    if (legacy && !out.includes(legacy)) out.push(legacy);
  }
  if (typeof plural === "string") {
    for (const part of plural.split(",")) push(part);
  }
  return out;
};

const jitsiEndpoints = (() => {
  const list = parseEndpointList(VITE_JITSI_ENDPOINT, VITE_JITSI_ENDPOINTS);
  return list.length ? list : [window.location.origin];
})();

// Entry 0 of the list — identical to the previous single-value derivation
// (`VITE_JITSI_ENDPOINT` minus a trailing "/", else the page origin).
const jitsiEndpoint = jitsiEndpoints[0];

/**
 * MediaMTX playback origin for RTMP stream feeds (e.g.
 * `https://streaming2.upstage.live`). Unlike JITSI_ENDPOINT there is no
 * same-origin fallback: when unset, every RTMP feature (studio "New stream
 * feed", live playback) stays hidden and the app behaves exactly as before.
 */
const rtmpEndpoints = parseEndpointList(VITE_RTMP_ENDPOINT, VITE_RTMP_ENDPOINTS);
const rtmpEndpoint = rtmpEndpoints[0] ?? "";

/** OBS "Server" value for one MediaMTX origin: rtmp://<host>/live ("" when unusable). */
export const rtmpIngestEndpointFor = (origin: string | null | undefined): string => {
  if (!origin) return "";
  try {
    return `rtmp://${new URL(origin).host}/live`;
  } catch {
    return "";
  }
};

/** OBS "Server" value: rtmp://<media host>/live (empty when RTMP is disabled). */
const rtmpIngestEndpoint = rtmpIngestEndpointFor(rtmpEndpoint);

// "Counted at startup": one line so an operator can confirm which servers a
// deployed bundle knows about without digging through the .env it was built
// from. Guarded so unit tests that stub `console` stay quiet.
if (typeof console !== "undefined" && typeof console.info === "function") {
  console.info(
    `[config] streaming servers: ${jitsiEndpoints.length} Jitsi, ${rtmpEndpoints.length} RTMP`,
    { jitsi: jitsiEndpoints, rtmp: rtmpEndpoints },
  );
}

const configs = {
  MODE: import.meta.env.VITE_ENV_TYPE as "Development" | "Production",
  UPSTAGE_URL: window.location.origin,
  ALLOWED_EXTENSIONS: {
    IMAGE: ".svg,.jpg,.jpeg,.png,.gif",
    AUDIO: ".wav,.mpeg,.mp3,.aac,.aacp,.ogg,.webm,.flac,.m4a",
    VIDEO: ".mp4,.webm,.opgg,.3gp,.flv",
  },
  ROLES: {
    GUEST: 4,
    PLAYER: 1,
    ADMIN: 8,
    SUPER_ADMIN: 32,
  },
  MEDIA_COPYRIGHT_LEVELS: [
    {
      value: 0,
      name: "✅ Copyright free",
      description: "Can be used by other players in any way without need for permission",
    },
    {
      value: 1,
      name: "👌 Use with acknowledgement",
      description: "Other players can use the media item as long as the owner is acknowledged",
    },
    {
      value: 2,
      name: "🔐 Use with permission",
      description:
        "Other players must ask the owner for permission if they want to use the media item",
    },
    {
      value: 3,
      name: "🔒️ Not shared",
      description:
        "Only the owner can assign this media item to a stage. Once it is assigned to a stage it can be used there by players who have access to that stage.",
    },
  ],

  // Character limit for a player's introduction. Must match the backend's
  // CreateUserInput/UpdateUserInput `intro` max_length (upstage_backend
  // users/http/validation.py and studio_management/http/validation.py).
  INTRO_MAX_LENGTH: 5000,
  GRAPHQL_ENDPOINT: graphqlEndpoint,
  STATIC_ASSETS_ENDPOINT: staticAssetsEndpoint,
  CLOUDFLARE_CAPTCHA_SITEKEY: VITE_CLOUDFLARE_CAPTCHA_SITEKEY,
  AXIOS_TIMEOUT: 10000,
  JITSI_ENDPOINT: jitsiEndpoint,
  RTMP_ENDPOINT: rtmpEndpoint,
  RTMP_INGEST_ENDPOINT: rtmpIngestEndpoint,
  /**
   * Multi-server streaming (see MULTI_SERVER_STREAMING_PLAN_2026-09-10.md).
   * Ordered origin lists; entry 0 is always the singular value above. A
   * server's *id* everywhere (board objects, stream feed assets, stage
   * config) is its normalised origin string, never its list index.
   */
  JITSI_ENDPOINTS: jitsiEndpoints,
  RTMP_ENDPOINTS: rtmpEndpoints,
  JITSI_SERVER_COUNT: jitsiEndpoints.length,
  RTMP_SERVER_COUNT: rtmpEndpoints.length,
  MQTT_NAMESPACE: VITE_MQTT_NAMESPACE,
  // Transport settings only. The broker username/password deliberately do NOT
  // live here: Vite inlines `import.meta.env.VITE_*` by textual substitution, so
  // anything referenced here ends up as a literal string in the public bundle.
  // Credentials arrive at runtime on `Stage.mqtt` and are passed to
  // `mqtt.connect(credentials)`. Never reintroduce a VITE_ fallback for them —
  // a fallback branch re-bakes the secret whether or not it ever executes.
  MQTT_CONNECTION: {
    url: VITE_MQTT_ENDPOINT,
    clean: true, // Reserved session
    connectTimeout: 4000, // Time out
    reconnectPeriod: 4000, // Reconnection interval (ms); mqtt.js auto-retries on connection loss using this
    retain: true,
  },
  STRIPE_KEY: VITE_STRIPE_KEY,
  RELEASE_VERSION: VITE_RELEASE_VERSION || "2026.05.05",
  ALIAS_RELEASE_VERSION: VITE_ALIAS_RELEASE_VERSION || "84a231c",
};

export default configs;
