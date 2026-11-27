<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    src: string;
    size?: number | string;
    width?: number | string;
    height?: number | string;
  }>(),
  { size: 16 },
);

const path = computed(() => `/icons/${props.src}`);
</script>

<template>
  <img :src="path" :style="{ width: (width ?? size) + 'px', height: (height ?? size) + 'px' }" />
</template>

<style lang="scss" scoped></style>
