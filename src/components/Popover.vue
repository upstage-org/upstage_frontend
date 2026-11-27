<script setup lang="ts">
import { ref } from "vue";
import { animate } from "animejs";

const position = ref<{ x: number; y: number } | null>();
const show = (e: MouseEvent) => {
  position.value = {
    x: e.clientX,
    y: e.clientY,
  };
};

const hide = () => {
  position.value = null;
};

const enter = (el: Element, complete: () => void) => {
  animate(el, {
    onComplete: complete,
  });
};
</script>

<template>
  <div v-click-outside="hide" class="popover" @mouseenter="show" @mouseleave="hide">
    <slot name="trigger" />

    <transition @enter="enter">
      <div v-if="position" class="card">
        <slot />
      </div>
    </transition>
  </div>
</template>

<style scoped>
.popover {
  display: inline;
  cursor: pointer;
}
</style>
