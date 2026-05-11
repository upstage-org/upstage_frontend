<script>
import { computed, reactive } from "vue";
import { watch } from "vue";
import { useStore } from "vuex";
// Aliased: "Image" is a reserved HTML element name (vue/no-reserved-component-names).
import AppImage from "../Image.vue";

export default {
  components: { AppImage },
  setup: () => {
    const store = useStore();
    const background = computed(() => store.state.stage.background);
    const backgroundOpacity = computed(() => store.state.stage.background?.opacity ?? 1);
    const transitionDuration = computed(() => (store.state.stage.background?.speed || 0) * 1000);

    const frameAnimation = reactive({
      interval: null,
      currentFrame: null,
    });
    const src = computed(() => {
      if (!background.value) {
        return null;
      }
      if (background.value.multi && background.value.speed > 0) {
        return frameAnimation.currentFrame;
      } else {
        return background.value.currentFrame ?? background.value.src;
      }
    });

    watch(
      background,
      (value) => {
        if (!value) return;
        const { speed, frames, currentFrame } = value;
        if (currentFrame) {
          frameAnimation.currentFrame = currentFrame;
        }
        clearInterval(frameAnimation.interval);
        if (frames) {
          frameAnimation.interval = setInterval(
            () => {
              let nextFrame = frames.indexOf(frameAnimation.currentFrame) + 1;
              if (nextFrame >= frames.length) {
                nextFrame = 0;
              }
              frameAnimation.currentFrame = frames[nextFrame];
            },
            parseFloat(speed || 0) * 1000,
          );
        }
      },
      { immediate: true },
    );

    return { backgroundOpacity, transitionDuration, src };
  },
};
</script>

<template>
  <AppImage
    v-if="src"
    class="background-image"
    :src="src"
    :style="{
      opacity: backgroundOpacity,
    }"
    :transition="transitionDuration"
    :no-fallback="true"
    fit="cover"
  />
</template>

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
