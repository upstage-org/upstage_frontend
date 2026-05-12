/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_ENV_TYPE?: "Development" | "Production";
  readonly VITE_GRAPHQL_ENDPOINT?: string;
  readonly VITE_STATIC_ASSETS_ENDPOINT?: string;
  readonly VITE_CLOUDFLARE_CAPTCHA_SITEKEY?: string;
  readonly VITE_MQTT_NAMESPACE?: string;
  readonly VITE_MQTT_ENDPOINT?: string;
  readonly VITE_MQTT_USERNAME?: string;
  readonly VITE_MQTT_PASSWORD?: string;
  readonly VITE_JITSI_ENDPOINT?: string;
  /**
   * Optional XMPP virtual-host overrides for Jitsi. Production installs
   * usually have the XMPP domain == HTTP hostname (e.g. `meet.example.com`)
   * and can leave these unset — `useJitsiEndpoint()` will derive them from
   * `VITE_JITSI_ENDPOINT`. Local installs (notably the
   * `jitsi/docker-jitsi-meet` quickstart) fix the XMPP domain at
   * `meet.jitsi` regardless of which HTTP host the web UI is exposed on, so
   * the browser must address its XMPP stream to `meet.jitsi`, not to the
   * transport hostname, to avoid Prosody replying with empty
   * `<mechanisms>` ("Server did not offer a supported authentication
   * mechanism").
   */
  readonly VITE_JITSI_XMPP_DOMAIN?: string;
  readonly VITE_JITSI_XMPP_MUC_DOMAIN?: string;
  readonly VITE_JITSI_XMPP_FOCUS_DOMAIN?: string;
  readonly VITE_JITSI_PREFER_WEBSOCKET?: string;
  readonly VITE_STRIPE_KEY?: string;
  readonly VITE_RELEASE_VERSION?: string;
  readonly VITE_ALIAS_RELEASE_VERSION?: string;
  /**
   * When truthy at build time, expose every Pinia store on
   * `window.__UPSTAGE_PINIA__` so Playwright `e2e:perform` /
   * `e2e:features` can drive `stage.placeObjectOnStage(...)` etc.
   * directly. `import.meta.env.DEV` already covers `pnpm dev`; this
   * flag is for served `vite build` bundles used by run_front_end_*.sh.
   */
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
