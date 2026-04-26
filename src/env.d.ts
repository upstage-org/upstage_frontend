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
  readonly VITE_STRIPE_KEY?: string;
  readonly VITE_RELEASE_VERSION?: string;
  readonly VITE_ALIAS_RELEASE_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
