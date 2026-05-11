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
// Pinia `stage` store — Phase 5.3 migration in progress (Wave C: state +
// getters + mutations + actions all ported). No consumers read from it
// yet (Wave D's job); it's exported so the `__UPSTAGE_PINIA__` dev hook
// in `main.ts` and e2e probes can reach it.
export { useStageStore } from "./stage";
