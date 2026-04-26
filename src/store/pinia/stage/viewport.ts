import { defineStore } from "pinia";
import { computed, reactive } from "vue";

interface ViewportSize {
  width: number;
  height: number;
}

export const useStageViewportStore = defineStore("stage-viewport", () => {
  const viewport = reactive<ViewportSize>({
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  });

  const stageSize = computed<ViewportSize>(() => ({
    width: viewport.width,
    height: viewport.height,
  }));

  const setViewport = (size: ViewportSize) => {
    viewport.width = size.width;
    viewport.height = size.height;
  };

  return { viewport, stageSize, setViewport };
});
