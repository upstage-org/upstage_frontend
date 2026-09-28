<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { CSSProperties } from "vue";

const props = withDefaults(
  defineProps<{
    src: string;
    fit?: CSSProperties["objectFit"];
    transition?: number;
    noFallback?: boolean;
    rotate?: number;
    opacity?: number;
  }>(),
  {
    fit: "contain",
    transition: 1000,
    noFallback: false,
    rotate: 0,
    opacity: 1,
  },
);

// Display is decoupled from `props.src`: a new src is preloaded
// off-screen and only committed once it has actually loaded. On a
// failed load we keep the current image on screen — media here is
// served no-cache/must-revalidate, so animated multi-frame objects
// revalidate over the network on EVERY frame swap, and a transient
// failure used to flash the notfound placeholder mid-animation (or
// stick on it if the last swap of a play-once run failed). The
// placeholder is reserved for media that has never displayed at all.
const displayedSrc = ref(props.src);
const fallback = ref(false);
const everDisplayed = ref(false);
let latestToken = 0;
let pending: HTMLImageElement | null = null;

const onDisplayedLoad = () => {
  everDisplayed.value = true;
  fallback.value = false;
};
const onDisplayedError = () => {
  if (!everDisplayed.value) fallback.value = true;
};

watch(
  () => props.src,
  (src) => {
    const token = ++latestToken;
    pending = null;
    if (!src) {
      displayedSrc.value = src;
      return;
    }
    if (src === displayedSrc.value) return;
    const img = new Image();
    pending = img;
    img.onload = () => {
      if (token !== latestToken) return;
      pending = null;
      displayedSrc.value = src;
      everDisplayed.value = true;
      fallback.value = false;
    };
    img.onerror = () => {
      if (token !== latestToken) return;
      pending = null;
      if (!everDisplayed.value) fallback.value = true;
    };
    img.src = src;
  },
);

onBeforeUnmount(() => {
  latestToken++;
  if (pending) {
    pending.onload = null;
    pending.onerror = null;
    pending = null;
  }
});

const transitionDuration = computed(() => `${props.transition / 1000}s`);
</script>

<template>
  <transition name="fade">
    <img v-if="fallback && !noFallback" src="assets/notfound.svg" />
    <img
      v-else
      :key="displayedSrc"
      :src="displayedSrc"
      :style="{
        'object-fit': fit,
        opacity,
        transform: `rotate(${rotate}deg)`,
      }"
      @load="onDisplayedLoad"
      @error="onDisplayedError"
    />
  </transition>
</template>

<style scoped>
img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  will-change: opacity;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity v-bind(transitionDuration);
  position: absolute;
}
.fade-enter,
.fade-leave-to {
  opacity: 0 !important;
}
.fade-enter-active {
  z-index: -1;
}
</style>
