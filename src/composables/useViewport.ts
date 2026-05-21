import { useWindowSize } from "@vueuse/core";
import { computed } from "vue";

/**
 * Reactive window viewport size. Replaces ad-hoc `window.innerWidth` reads
 * scattered through the stage modules.
 */
export const useViewport = () => {
  const { width, height } = useWindowSize();
  const viewport = computed(() => ({ width: width.value, height: height.value }));
  return { width, height, viewport };
};
