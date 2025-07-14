export const getViewport = () => ({
  width: typeof window !== 'undefined' ? window.innerWidth : 0,
  height: typeof window !== 'undefined' ? window.innerHeight : 0,
});

/**
 * Call this function in a component's onMounted hook to reactively update the stage store's viewport on resize.
 * Returns a cleanup function to remove the event listener (call in onUnmounted).
 */
export function initReactiveViewport() {
  const resizeHandler = () => {
    // Lazy import to avoid circular dependency
    const { useStageStore } = require('./index');
    const stageStore = useStageStore();
    const oldSize = stageStore.stageSize?.width;
    stageStore.viewport = getViewport();
    const newSize = stageStore.stageSize?.width;
    if (oldSize && newSize && typeof stageStore.rescaleObjects === 'function') {
      const scale = newSize / oldSize;
      stageStore.rescaleObjects(scale);
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', resizeHandler);
  }

  // Initial set
  resizeHandler();

  // Return cleanup function
  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', resizeHandler);
    }
  };
}
