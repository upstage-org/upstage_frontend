<template>
  <canvas
    class="whiteboard"
    ref="el"
    :style="{ top: stageSize.top + 'px', left: stageSize.left + 'px' }"
  />
</template>

<script>
import { computed } from "vue";
import { useDrawing } from "./Toolboxs/tools/Draw/composable";
import { useStore } from "vuex";

const DEFAULT_STROKE_COLOR = "#000000";

export default {
  setup: () => {
    const store = useStore();
    const stageSize = computed(() => store.getters["stage/stageSize"]);
    const whiteboard = computed(() => store.getters["stage/whiteboard"]);
    // Deep-clone commands with primitive colors only so no reactive ref can affect drawn strokes
    const drawing = computed(() => {
      const raw = whiteboard.value || [];
      const commands = raw.map((c) => ({
        type: c.type,
        size: c.size,
        x: c.x,
        y: c.y,
        color: typeof c.color === "string" ? c.color : DEFAULT_STROKE_COLOR,
        lines: (c.lines || []).map((l) => ({
          x: l.x,
          y: l.y,
          fromX: l.fromX,
          fromY: l.fromY,
        })),
      }));
      return {
        w: stageSize.value.width,
        h: stageSize.value.height,
        commands,
        original: {
          x: 0,
          y: 0,
          w: stageSize.value.width / stageSize.value.height,
          h: 1,
        },
      };
    });
    const { el } = useDrawing(drawing);
    return { el, stageSize };
  },
};
</script>

<style scoped>
.whiteboard {
  position: fixed;
  pointer-events: none;
}
</style>
