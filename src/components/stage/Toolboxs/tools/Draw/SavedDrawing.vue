<script setup lang="ts">
import { computed } from "vue";
import { useDrawing } from "./composable";

const props = defineProps<{
  drawing?: Record<string, any>;
}>();

const drawing = computed<any>(() => ({ ...props.drawing, w: 64, h: 64 }));
const { el } = useDrawing(drawing);
</script>

<template>
  <canvas ref="el" />
</template>

<style></style>
