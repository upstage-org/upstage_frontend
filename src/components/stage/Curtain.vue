<script>
import { computed } from "vue";
import { animate } from "animejs";
import { useStageStore } from "@stores/pinia/stage";
export default {
  setup: () => {
    const stageStore = useStageStore();
    const canPlay = computed(() => stageStore.canPlay);
    const curtain = computed(() => stageStore.curtain);
    const config = computed(() => stageStore.config);
    const curtainSpeed = computed(() => config.value?.animations?.curtainSpeed ?? 3000);

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
        v-if="curtain"
        :key="curtain"
        :src="curtain"
        class="curtain"
        :class="{ 'dual-left': dualCurtain }"
      />
    </transition>
    <transition @enter="dualCurtainEnter" @leave="dualCurtainLeave">
      <img
        v-if="dualCurtain && curtain"
        :key="curtain"
        :src="curtain"
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
