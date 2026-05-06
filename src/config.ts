
const {
  VITE_GRAPHQL_ENDPOINT,
  VITE_STATIC_ASSETS_ENDPOINT,
  VITE_CLOUDFLARE_CAPTCHA_SITEKEY,
  VITE_MQTT_NAMESPACE,
  VITE_MQTT_ENDPOINT,
  VITE_MQTT_USERNAME,
  VITE_MQTT_PASSWORD,
  VITE_JITSI_ENDPOINT,
  VITE_STRIPE_KEY,
  VITE_RELEASE_VERSION,
  VITE_ALIAS_RELEASE_VERSION
} = import.meta.env;

// Fallback when env was not set at build time (e.g. wrong .env path or CI build)
const ensureTrailingSlash = (url: string) => (url.endsWith("/") ? url : `${url}/`);

const graphqlFromEnv =
  typeof VITE_GRAPHQL_ENDPOINT === "string" && VITE_GRAPHQL_ENDPOINT
    ? ensureTrailingSlash(VITE_GRAPHQL_ENDPOINT)
    : ensureTrailingSlash(`${window.location.origin}/api/`);

/**
 * In dev, `VITE_GRAPHQL_ENDPOINT=http://localhost:3001/api/` breaks the SPA: the
 * browser would POST cross-origin to :3001 (no Vite `server.proxy`). Studio is on
 * 3001, but the page is on 3000 — use the same origin + `/api/` so the proxy works.
 * Node/e2e should keep calling 3001 directly (see `tests/e2e/graphql.ts`).
 */
function resolveGraphqlEndpoint(): string {
  if (!import.meta.env.DEV) {
    return graphqlFromEnv;
  }
  try {
    const apiUrl = new URL(graphqlFromEnv, window.location.origin);
    const isLocal = ["localhost", "127.0.0.1"].includes(apiUrl.hostname);
    if (isLocal && apiUrl.origin !== window.location.origin) {
      return ensureTrailingSlash(`${window.location.origin}/api/`);
    }
  } catch {
    // keep graphqlFromEnv
  }
  return graphqlFromEnv;
}

const graphqlEndpoint = resolveGraphqlEndpoint();
const staticAssetsEndpoint =
  (typeof VITE_STATIC_ASSETS_ENDPOINT === "string" && VITE_STATIC_ASSETS_ENDPOINT)
    ? ensureTrailingSlash(VITE_STATIC_ASSETS_ENDPOINT)
    : ensureTrailingSlash(`${window.location.origin}/resources/`);

const jitsiEndpoint =
  (typeof VITE_JITSI_ENDPOINT === "string" && VITE_JITSI_ENDPOINT)
    ? VITE_JITSI_ENDPOINT.replace(/\/$/, "")
    : window.location.origin;

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
      description:
        "Can be used by other players in any way without need for permission",
    },
    {
      value: 1,
      name: "👌 Use with acknowledgement",
      description:
        "Other players can use the media item as long as the owner is acknowledged",
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

  GRAPHQL_ENDPOINT: graphqlEndpoint,
  STATIC_ASSETS_ENDPOINT: staticAssetsEndpoint,
  CLOUDFLARE_CAPTCHA_SITEKEY: VITE_CLOUDFLARE_CAPTCHA_SITEKEY,
  AXIOS_TIMEOUT: 10000,
  JITSI_ENDPOINT: jitsiEndpoint,
  MQTT_NAMESPACE: VITE_MQTT_NAMESPACE,
  MQTT_CONNECTION: {
    url: VITE_MQTT_ENDPOINT,
    username: VITE_MQTT_USERNAME,
    password: VITE_MQTT_PASSWORD,
    clean: true, // Reserved session
    connectTimeout: 4000, // Time out
    reconnectPeriod: 4000, // Reconnection interval (ms); mqtt.js auto-retries on connection loss using this
    retain: true,
  },
  STRIPE_KEY: VITE_STRIPE_KEY,
  RELEASE_VERSION: VITE_RELEASE_VERSION || '2026.05.05',
  ALIAS_RELEASE_VERSION: VITE_ALIAS_RELEASE_VERSION || '84a231c',
};

export default configs;
