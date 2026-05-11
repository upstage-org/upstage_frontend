<script>
import { computed } from "vue";
import { useDrawing } from "./composable";
export default {
  props: { drawing: Object },
  setup: (props) => {
    const drawing = computed(() => ({ ...props.drawing, w: 64, h: 64 }));
    const { el } = useDrawing(drawing);
    return { el };
  },
};
</script>

<template>
  <canvas ref="el" />
</template>

<style></style>
