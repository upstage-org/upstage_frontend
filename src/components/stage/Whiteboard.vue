<script>
import { computed } from "vue";
import { useDrawing } from "./Toolboxs/tools/Draw/composable";
import { useStore } from "vuex";
export default {
  setup: () => {
    const store = useStore();
    const stageSize = computed(() => store.getters["stage/stageSize"]);
    const whiteboard = computed(() => store.getters["stage/whiteboard"]);
    const drawing = computed(() => ({
      w: stageSize.value.width,
      h: stageSize.value.height,
      commands: whiteboard.value,
      original: {
        x: 0,
        y: 0,
        w: stageSize.value.width / stageSize.value.height,
        h: 1,
      },
    }));
    const { el } = useDrawing(drawing);
    return { el, stageSize };
  },
};
</script>

<template>
  <canvas
    ref="el"
    class="whiteboard"
    :style="{ top: stageSize.top + 'px', left: stageSize.left + 'px' }"
  />
</template>

<style scoped>
.whiteboard {
  position: fixed;
  pointer-events: none;
}
</style>
