/**
 * Stage viewport helper.
 *
 * The resize listener lives in a composable that App.vue opts into via
 * `useStageViewport()`, using `useEventListener` from `@vueuse/core` so
 * it is automatically cleaned up — important because an earlier
 * module-load-time `window.addEventListener("resize", ...)` leaked
 * across HMR boundaries and could fire before the store was ready.
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
