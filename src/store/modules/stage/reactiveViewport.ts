/**
 * Stage viewport helper.
 *
 * The legacy implementation registered a `window.addEventListener("resize", ...)`
 * at module-load time and committed Vuex mutations from inside the listener,
 * which leaked across HMR boundaries and could fire before the store was
 * ready. The listener now lives in a composable that the App component opts
 * into via `useStageViewport()` in `App.vue`, using `useEventListener` from
 * `@vueuse/core` so it is automatically cleaned up.
 */
import { useEventListener } from "@vueuse/core";
import store from "@stores/index";

export const getViewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

export const useStageViewport = (): void => {
  // Seed the real viewport once App.vue mounts. The stage module's initial
  // state ships {0, 0} on purpose to keep getViewport() out of the module
  // graph at load time (avoids a Vuex import cycle / TDZ).
  store.commit("stage/UPDATE_VIEWPORT", getViewport());

  useEventListener(window, "resize", () => {
    const oldSize = store.getters["stage/stageSize"].width;
    store.commit("stage/UPDATE_VIEWPORT", getViewport());
    const newSize = store.getters["stage/stageSize"].width;
    if (oldSize > 0) {
      store.commit("stage/RESCALE_OBJECTS", newSize / oldSize);
    }
  });
};
