/// <reference types="vite/client" />

declare module "*.vue" {
  import { DefineComponent } from "vue";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

// Global references to avoid circular dependencies
declare global {
  interface Window {
    __UPSTAGE_STORE__?: any;
    __UPSTAGE_ROUTER__?: any;
  }
}
