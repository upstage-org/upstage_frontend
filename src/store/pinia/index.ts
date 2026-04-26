import { createPinia } from "pinia";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";

/**
 * Singleton Pinia instance. Install in `main.ts` via `app.use(pinia)` BEFORE
 * the router/store are wired up so route guards can read from Pinia stores.
 */
export const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

export default pinia;

export { useAuthStore } from "./auth";
export { useUserStore } from "./user";
export { useCacheStore } from "./cache";
export { useConfigStore } from "./config";
