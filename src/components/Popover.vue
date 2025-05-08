<template>
  <div
    @mouseenter="show"
    @mouseleave="hide"
    v-click-outside="hide"
    class="popover"
  >
    <slot name="trigger" />

    <transition @enter="enter">
      <div v-if="position" class="card">
        <slot />
      </div>
    </transition>
  </div>
</template>

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

<style scoped>
.popover {
  display: inline;
  cursor: pointer;
}
</style>
