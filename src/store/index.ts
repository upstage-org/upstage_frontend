import { createStore } from "vuex";
import stage from "./modules/stage";

/**
 * Vuex root store. Only the `stage` module remains here; `auth`, `cache`,
 * `config`, and `user` were migrated to Pinia (`src/store/pinia/*`) in the
 * Phase 5 cutover. The stage module will follow in a later phase.
 *
 * Persistence (`vuex-persistedstate`) was removed alongside the auth
 * cutover — it was scoped to `paths: ['auth']` and Pinia handles auth
 * persistence directly via `pinia-plugin-persistedstate`.
 */
export default createStore({
  modules: {
    stage,
  },
});
