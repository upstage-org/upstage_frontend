<script setup lang="ts">
/*
 * Mirrors the preload-completion path in views/live/Preloader.vue
 * (watchEffect + hidden <img>s + optional live-timeout) without the
 * full-screen splash / click-through UX. Stage store `ready` stays
 * gated on !preloading, so standalone /chat/:url must mount this or
 * it shows "Loading..." forever whenever the stage has avatars/backdrops/etc.
 */
import { computed, onUnmounted, ref, watch, watchEffect } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { useAttribute } from "services/graphql/composable";

const stageStore = useStageStore();
const preloadableAssets = computed<string[]>(() => stageStore.preloadableAssets);
const model = computed(() => stageStore.model);
const progress = ref(0);

watch(
  () => model.value?.id,
  () => {
    progress.value = 0;
  },
);

const stopLoading = () => stageStore.SET_PRELOADING_STATUS(false);

const increaseProgress = () => {
  progress.value++;
  if (
    progress.value === preloadableAssets.value.length ||
    progress.value === preloadableAssets.value.length - 1
  ) {
    stopLoading();
  }
};

watchEffect(() => {
  if (preloadableAssets.value.length === 0 && model.value) {
    stopLoading();
  }
});

const statusFromAttributes = useAttribute(model, "status");
const status = computed(() => model.value?.status ?? statusFromAttributes.value ?? "rehearsal");
const timer = ref<ReturnType<typeof setTimeout>>();
watch(model, (val) => {
  if (val && status.value === "live") {
    timer.value = setTimeout(stopLoading, 60000);
  }
});

onUnmounted(() => {
  if (timer.value) clearTimeout(timer.value);
});
</script>

<template>
  <div v-if="model && preloadableAssets.length" id="chat-hidden-preload" aria-hidden="true">
    <img
      v-for="(src, idx) in preloadableAssets"
      :key="`${idx}-${src}`"
      :src="src"
      @load="increaseProgress"
      @error="increaseProgress"
    />
  </div>
</template>

<style scoped lang="scss">
#chat-hidden-preload {
  width: 0;
  height: 0;
  overflow: hidden;
  position: absolute;
  pointer-events: none;
}
</style>
