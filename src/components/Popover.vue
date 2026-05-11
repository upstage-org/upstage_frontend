<script>
import { ref } from "vue";
import { animate } from "animejs";
export default {
  setup: () => {
    const position = ref();
    const show = (e) => {
      position.value = {
        x: e.clientX,
        y: e.clientY,
      };
    };

    const hide = () => {
      position.value = null;
    };

    const enter = (el, complete) => {
      animate(el, {
        onComplete: complete,
      });
    };

    return { show, hide, position, enter };
  },
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
