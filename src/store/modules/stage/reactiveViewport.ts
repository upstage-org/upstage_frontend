/**
 * Stage viewport helper.
 *
 * The legacy implementation registered a `window.addEventListener("resize", ...)`
 * at module-load time and committed Vuex mutations from inside the listener,
 * which leaked across HMR boundaries and could fire before the store was
 * ready. The listener now lives in a composable that the App component opts
 * into via `useStageViewport()` in `App.vue`, using `useEventListener` from
 * `@vueuse/core` so it is automatically cleaned up.
 *
 * Wave E migration: was committing to the Vuex stage facade; now goes
 * straight to the Pinia stage store. Both paths land in the same
 * `UPDATE_VIEWPORT` / `RESCALE_OBJECTS` mutations, so the migration is
 * a pure shortening of the dispatch path.
 */
import { useEventListener } from "@vueuse/core";
import { useStageStore } from "@stores/pinia/stage";

export const getViewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

export const useStageViewport = (): void => {
  const stageStore = useStageStore();
  // Seed the real viewport once App.vue mounts. The stage store's
  // initial state ships {0, 0} on purpose to keep getViewport() out
  // of the module graph at load time (avoids an import cycle / TDZ).
  stageStore.UPDATE_VIEWPORT(getViewport());

  useEventListener(window, "resize", () => {
    const oldSize = stageStore.stageSize.width;
    stageStore.UPDATE_VIEWPORT(getViewport());
    const newSize = stageStore.stageSize.width;
    if (oldSize > 0) {
      stageStore.RESCALE_OBJECTS(newSize / oldSize);
    }
  });
};
