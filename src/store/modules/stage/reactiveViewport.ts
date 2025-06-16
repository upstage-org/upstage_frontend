import { useStageStore } from './index';

export const getViewport = () => ({
  width: window?.innerWidth,
  height: window?.innerHeight,
});

window.addEventListener("resize", () => {
  const stageStore = useStageStore();
  const oldSize = stageStore.stageSize?.width;
  stageStore.viewport = getViewport();
  const newSize = stageStore.stageSize?.width;
  
  // Trigger rescale of objects based on the new size ratio
  const scale = newSize / oldSize;
  stageStore.rescaleObjects(scale);
});
