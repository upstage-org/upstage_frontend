<script setup lang="ts">
/**
 * Inline loading indicator. Defaults to Ant Design `<a-spin />` so Studio / Stage
 * Management match the Suspense fallback in `Authorized.vue`. Pass `src` only
 * when a bespoke asset is required (e.g. Jitsi video placeholder).
 */
withDefaults(
  defineProps<{
    width?: string;
    height?: string;
    src?: string;
  }>(),
  {
    width: "100%",
    height: "150px",
    src: "",
  },
);
</script>

<template>
  <img v-if="src" :src="src" :style="{ width, height }" alt="" />
  <div v-else class="upstage-inline-loading" :style="{ width, minHeight: height }">
    <a-spin />
  </div>
</template>

<style scoped>
.upstage-inline-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}
</style>
