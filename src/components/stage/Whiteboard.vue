<template>
  <canvas class="whiteboard" ref="el" :style="{ top: stageSize.top + 'px', left: stageSize.left + 'px' }" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useDrawing } from "./Toolboxs/tools/Draw/composable";
import { useStageStore } from "../../store/stage";

const store = useStageStore();
const stageSize = computed(() => store.stageSize);
const whiteboard = computed(() => store.whiteboard);

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
</script>

<style scoped>
.whiteboard {
  position: fixed;
  pointer-events: none;
}
</style>
