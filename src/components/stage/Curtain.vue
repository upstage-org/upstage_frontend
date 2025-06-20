<template>
  <div :style="{ opacity: canPlay ? 0.5 : 1 }">
    <transition @enter="curtainEnter" @leave="curtainLeave">
      <img v-if="curtain" :key="curtain" :src="curtain" class="curtain" :class="{ 'dual-left': dualCurtain }" />
    </transition>
    <transition @enter="dualCurtainEnter" @leave="dualCurtainLeave">
      <img v-if="dualCurtain && curtain" :key="curtain" :src="curtain" class="curtain"
        :class="{ 'dual-right': dualCurtain }" />
    </transition>
  </div>
</template>

<script setup lang="ts">
import { animate } from "animejs";
import { storeToRefs } from 'pinia';
import { useCurtainStore } from "store/modules/curtain";

const store = useCurtainStore();
const { curtain, canPlay, dualCurtain, curtainSpeed, config } = storeToRefs(store);

const curtainEnter = (el: Element, complete: () => void) => {
  const duration = curtainSpeed.value;
  const htmlEl = el as HTMLElement;
  switch (config.value?.animations?.curtain) {
    case "fade":
      animate(htmlEl, {
        opacity: [0, 1],
        duration,
        onComplete: complete,
      });
      break;
    case "close":
      htmlEl.style.transformOrigin = "0 0";
      animate(htmlEl, {
        scaleX: [0, 1],
        duration,
        onComplete: complete,
      });
      break;
    default:
      animate(htmlEl, {
        scaleY: [0, 1],
        duration,
        onComplete: complete,
      });
  }
};

const curtainLeave = (el: Element, complete: () => void) => {
  const duration = curtainSpeed.value;
  const htmlEl = el as HTMLElement;
  switch (config.value?.animations?.curtain) {
    case "fade":
      animate(htmlEl, {
        opacity: [1, 0],
        duration,
        onComplete: complete,
      });
      break;
    case "close":
      htmlEl.style.transformOrigin = "0 0";
      animate(htmlEl, {
        scaleX: [1, 0],
        duration,
        onComplete: complete,
      });
      break;
    default:
      animate(htmlEl, {
        scaleY: 0,
        duration,
        onComplete: complete,
      });
  }
};

const dualCurtainEnter = (el: Element, complete: () => void) => {
  const duration = curtainSpeed.value;
  const htmlEl = el as HTMLElement;
  htmlEl.style.transformOrigin = "100% 0";
  animate(htmlEl, {
    scaleX: [0, 1],
    duration,
    onComplete: complete,
  });
};

const dualCurtainLeave = (el: Element, complete: () => void) => {
  const duration = curtainSpeed.value;
  const htmlEl = el as HTMLElement;
  htmlEl.style.transformOrigin = "100% 0";
  animate(htmlEl, {
    scaleX: [1, 0],
    duration,
    onComplete: complete,
  });
};
</script>

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
