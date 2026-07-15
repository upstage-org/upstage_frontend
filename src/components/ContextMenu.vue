<script>
import { reactive, ref } from "vue";
import { onLongPress } from "@vueuse/core";
export default {
  props: {
    active: Boolean,
    padLeft: {
      type: Number,
      default: 0,
    },
    padTop: {
      type: Number,
      default: 0,
    },
    padRight: {
      type: Number,
      default: 0,
    },
    padBottom: {
      type: Number,
      default: 0,
    },
    opacity: {
      type: Number,
      default: 1,
    },
    style: Object,
    /**
     * Skip the synthesized `currentTarget.click()` when opening — for
     * triggers whose click is a real action (e.g. a Scene thumbnail click
     * switches scenes), so right-click only ever opens the menu. The menu
     * still opens; use `disabled` to suppress the menu entirely.
     */
    preventClicking: {
      type: Boolean,
      default: false,
    },
    /** No context menu at all (e.g. while replaying a recording). */
    disabled: {
      type: Boolean,
      default: false,
    },
  },
  setup: (props) => {
    const isActive = ref(props.active);
    const position = reactive({ x: 100, y: 100 });

    const openMenu = (e) => {
      if (props.disabled) {
        return;
      }
      if (!props.preventClicking) {
        e.currentTarget.click();
      }
      position.x = e.clientX + props.padLeft;
      position.y = e.clientY + props.padTop;
      isActive.value = true;
    };
    const closeMenu = () => (isActive.value = false);

    // Touch path: Android Chrome never fires `contextmenu` on long-press for
    // user-select:none elements (which every draggable / stage object is), so
    // the menu was unreachable on tablets. Long-press emulates right-click.
    const triggerEl = ref();
    // Draggable children (toolbox Skeletons) arm a polyfill drag 300ms into a
    // hold; once a real drag has started the long-press must not also open
    // the menu mid-drag. dragstart/dragend bubble up to the trigger wrapper.
    const dragging = ref(false);

    // The finger-lift after a long-press dispatches a compatibility `click`
    // on the element under the finger; the v-click-outside directive listens
    // for document clicks and would close the menu the instant it opened.
    // Swallow exactly that one click, self-removing so a genuinely later tap
    // (or a desktop click) is never eaten.
    const suppressNextClick = () => {
      let timer;
      const swallow = (ev) => {
        ev.stopPropagation();
        cleanup();
      };
      const cleanup = () => {
        document.removeEventListener("click", swallow, true);
        clearTimeout(timer);
      };
      document.addEventListener("click", swallow, true);
      timer = setTimeout(cleanup, 800);
    };

    onLongPress(
      triggerEl,
      (e) => {
        if (props.disabled) return;
        // Touch/pen only: on desktop a click-hold is a moveable drag in
        // progress, not a menu request.
        if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
        if (dragging.value) return;
        // Mirror openMenu's currentTarget.click(): closes other open menus /
        // deselects other objects via their click-outside handlers.
        // (e.currentTarget is null on a stored pointer event, hence the ref.)
        if (!props.preventClicking) triggerEl.value?.click();
        suppressNextClick();
        position.x = e.clientX + props.padLeft;
        position.y = e.clientY + props.padTop;
        isActive.value = true;
      },
      // distanceThreshold guarantees an in-progress object drag (moveable
      // grabs the object at touchstart) has barely moved before the menu
      // opens; larger movements are drags, not menu requests.
      { delay: 600, distanceThreshold: 10 },
    );

    const contextAppear = (el) => {
      const { width, height, right, bottom } = el?.getBoundingClientRect() ?? {};
      if (width == null || height == null) return;
      const margin = 8;
      // Preferred placement: flip the menu left / up when it would spill past
      // the right / bottom edges so it opens back towards the cursor.
      if (right > window.innerWidth - props.padRight) {
        position.x = position.x - width;
      }
      if (bottom > window.innerHeight - props.padBottom) {
        position.y = position.y - height;
      }
      // Then clamp the whole menu into the viewport. Without this a tall menu
      // — or one opened on an object high on the stage — could be pushed off
      // the top (the up-flip above subtracts the full menu height) or left
      // edge, leaving the upper menu items unreachable. Clamping the top/left
      // to a small margin keeps those first items on screen even when the menu
      // is taller than the area above the cursor.
      position.x = Math.min(
        Math.max(position.x, margin),
        Math.max(margin, window.innerWidth - width - margin),
      );
      position.y = Math.min(
        Math.max(position.y, margin),
        Math.max(margin, window.innerHeight - height - margin),
      );
    };

    return { isActive, openMenu, closeMenu, position, contextAppear, triggerEl, dragging };
  },
};
</script>

<template>
  <div
    ref="triggerEl"
    :style="style"
    @contextmenu.prevent="openMenu"
    @dragstart="dragging = !$event.defaultPrevented"
    @dragend="dragging = false"
  >
    <slot name="trigger" />
  </div>
  <teleport to="body">
    <transition :css="false" @enter="contextAppear">
      <div
        v-if="$slots.context && isActive"
        v-click-outside="closeMenu"
        class="card"
        :style="{
          position: 'fixed',
          top: position.y + 'px',
          left: position.x + 'px',
          'z-index': 10000,
          overflow: 'visible',
          opacity,
        }"
      >
        <slot name="context" :close-menu="closeMenu" />
      </div>
    </transition>
  </teleport>
</template>

<style></style>
