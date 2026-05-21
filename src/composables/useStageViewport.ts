/**
 * Stage viewport helper.
 *
 * Resize listener lives in a composable that App.vue opts into via
 * `useStageViewport()`, using `useEventListener` from `@vueuse/core` so
 * it is automatically cleaned up.
 */
import { useEventListener } from "@vueuse/core";
import { useStageStore } from "@stores/pinia/stage";

export const getViewport = () => ({
  width: window.innerWidth,
  height: window.innerHeight,
});

export const useStageViewport = (): void => {
  const stageStore = useStageStore();
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
