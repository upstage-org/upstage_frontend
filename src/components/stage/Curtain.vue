<script>
import { computed, onUnmounted, reactive, watch } from "vue";
import { animate } from "animejs";
import { useStageStore } from "@stores/pinia/stage";
export default {
  setup: () => {
    const stageStore = useStageStore();
    const canPlay = computed(() => stageStore.canPlay);
    const curtain = computed(() => stageStore.curtain);
    const config = computed(() => stageStore.config);
    const curtainSpeed = computed(() => config.value?.animations?.curtainSpeed ?? 9100);

    // Multi-frame state. Mirrors `Backdrop.vue`'s `frameAnimation`: when a
    // multi-frame curtain is active and `speed > 0`, we cycle through
    // `frames` on a `setInterval`. The reactive `currentFrame` is what the
    // <img> reads; we seed it from the broadcast `currentFrame` (if any)
    // so audience members joining mid-rotation land on the same picture
    // the performer is showing.
    const frameAnimation = reactive({
      currentFrame: null,
      interval: null,
    });

    const clearFrameInterval = () => {
      if (frameAnimation.interval) {
        clearInterval(frameAnimation.interval);
        frameAnimation.interval = null;
      }
    };

    watch(
      curtain,
      (value) => {
        clearFrameInterval();
        if (!value) {
          frameAnimation.currentFrame = null;
          return;
        }
        const { src, multi, frames, speed, currentFrame } = value;
        if (currentFrame) {
          frameAnimation.currentFrame = currentFrame;
        } else if (multi && frames && frames.length) {
          frameAnimation.currentFrame = frames[0];
        } else {
          frameAnimation.currentFrame = src ?? null;
        }
        if (multi && frames && frames.length && (speed ?? 0) > 0) {
          frameAnimation.interval = setInterval(
            () => {
              const idx = frames.indexOf(frameAnimation.currentFrame);
              const next = idx + 1 >= frames.length ? 0 : idx + 1;
              frameAnimation.currentFrame = frames[next];
            },
            parseFloat(String(speed)) * 1000,
          );
        }
      },
      { immediate: true },
    );

    onUnmounted(clearFrameInterval);

    // Single URL the <img> tag reads. Falls back to the curtain's `src`
    // when there's no active frame (single-image curtain, or before the
    // first interval tick).
    const displaySrc = computed(() => frameAnimation.currentFrame ?? curtain.value?.src ?? null);

    const curtainEnter = (el, complete) => {
      const duration = curtainSpeed.value;
      switch (config.value?.animations?.curtain) {
        case "fade":
          animate(el, {
            opacity: [0, 1],
            duration,
            onComplete: complete,
          });
          break;
        case "close":
          el.style.transformOrigin = "0 0";
          animate(el, {
            scaleX: [0, 1],
            duration,
            onComplete: complete,
          });
          break;
        default:
          animate(el, {
            scaleY: [0, 1],
            duration,
            onComplete: complete,
          });
      }
    };
    const curtainLeave = (el, complete) => {
      const duration = curtainSpeed.value;
      switch (config.value?.animations?.curtain) {
        case "fade":
          animate(el, {
            opacity: [1, 0],
            duration,
            onComplete: complete,
          });
          break;
        case "close":
          el.style.transformOrigin = "0 0";
          animate(el, {
            scaleX: [1, 0],
            duration,
            onComplete: complete,
          });
          break;
        default:
          animate(el, {
            scaleY: 0,
            duration,
            onComplete: complete,
          });
      }
    };

    const dualCurtain = computed(() => config.value?.animations?.curtain === "close");

    const dualCurtainEnter = (el, complete) => {
      const duration = curtainSpeed.value;
      el.style.transformOrigin = "100% 0";
      animate(el, {
        scaleX: [0, 1],
        duration,
        onComplete: complete,
      });
    };

    const dualCurtainLeave = (el, complete) => {
      const duration = curtainSpeed.value;
      el.style.transformOrigin = "100% 0";
      animate(el, {
        scaleX: [1, 0],
        duration,
        onComplete: complete,
      });
    };

    return {
      canPlay,
      curtain,
      displaySrc,
      curtainEnter,
      curtainLeave,
      dualCurtain,
      dualCurtainEnter,
      dualCurtainLeave,
    };
  },
};
</script>

<template>
  <div :style="{ opacity: canPlay ? 0.5 : 1 }">
    <transition @enter="curtainEnter" @leave="curtainLeave">
      <img
        v-if="curtain && displaySrc"
        :key="curtain.src ?? curtain.id ?? ''"
        :src="displaySrc"
        class="curtain"
        :class="{ 'dual-left': dualCurtain }"
      />
    </transition>
    <transition @enter="dualCurtainEnter" @leave="dualCurtainLeave">
      <img
        v-if="dualCurtain && curtain && displaySrc"
        :key="curtain.src ?? curtain.id ?? ''"
        :src="displaySrc"
        class="curtain"
        :class="{ 'dual-right': dualCurtain }"
      />
    </transition>
  </div>
</template>

<style scoped>
.curtain {
  pointer-events: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  transform-origin: top;
}
.dual-left {
  width: 50vw;
}
.dual-right {
  width: 50vw;
  left: 50vw;
}
</style>
