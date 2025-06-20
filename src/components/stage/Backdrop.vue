<template>
  <Image v-if="src" class="background-image" :src="src" :style="{
    opacity: backgroundOpacity,
  }" :transition="transitionDuration" :no-fallback="true" fit="cover" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import Image from "../Image.vue";
import { useBackgroundStore } from "../../store/background";

const backgroundStore = useBackgroundStore();

const backgroundOpacity = computed(() => backgroundStore.backgroundOpacity);
const transitionDuration = computed(() => backgroundStore.transitionDuration);
const src = computed(() => {
  const background = backgroundStore.background;
  if (!background) return null;

  if (background.multi && background.speed && background.speed > 0) {
    return backgroundStore.currentFrame;
  }
  return background.currentFrame ?? background.src;
});
</script>

<style scoped>
.background-image {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  object-position: top;
}
</style>
