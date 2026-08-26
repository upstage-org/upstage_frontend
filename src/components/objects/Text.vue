<script>
// Aliased: "Object" is a reserved HTML element name (vue/no-reserved-component-names).
import AppObject from "./Object.vue";
import MenuContent from "./Avatar/ContextMenuAvatar.vue"; // Text should inherit all of avatar behavior
import { useStageStore } from "@stores/pinia/stage";
import { computed, onMounted, ref, watch } from "vue";

export default {
  components: { AppObject, MenuContent },
  props: { object: Object },
  setup: (props) => {
    const el = ref();
    const stageStore = useStageStore();

    const isFocus = ref(false);

    // Grow the object's frame to fit the text as it is typed. The frame
    // (object.w/h) is only measured once, when the text is first created in
    // TextTool.vue's saveText; editing on stage used to rely on the text
    // simply overflowing the fixed-size box, but `.object` now clips its
    // overflow (overflow: hidden in Object.vue), so without this the typed
    // text disappears past the frame edge. Grow-only: never shrink, so a
    // frame the user enlarged by hand is left alone. +10 matches saveText.
    const fitFrameToText = () => {
      const node = el.value;
      if (!node) return {};
      // Measure the text's INTRINSIC size, not the scroll box: scrollWidth/
      // scrollHeight are clamped to the clientWidth/Height of the p (which
      // fills the frame), so "scrollWidth + 10 > w" held on every keystroke
      // once the frame tracked instantly and the frame ratcheted +10 per
      // keyup forever. width: max-content shrink-wraps the p (and its
      // <div> lines) to the widest line for one synchronous measure.
      const prevWidth = node.style.width;
      node.style.width = "max-content";
      const neededW = node.offsetWidth + 10;
      const neededH = node.offsetHeight + 10;
      node.style.width = prevWidth;
      const w = Number(props.object.w) || 0;
      const h = Number(props.object.h) || 0;
      const grown = {};
      if (neededW > w) grown.w = neededW;
      if (neededH > h) grown.h = neededH;
      return grown;
    };

    const liveTyping = () => {
      const content = el.value.innerHTML;
      stageStore.shapeObject({
        ...props.object,
        content,
        ...fitFrameToText(),
      });
    };

    onMounted(() => {
      el.value.innerHTML = props.object.content;
      // The `.object` wrapper (our parent) clips with overflow: hidden, which
      // still makes it a scroll container: while the frame is animating to a
      // fitFrameToText-grown size, the browser scrolls it to keep the typing
      // caret visible, and that offset PERSISTS after the frame catches up —
      // the whole text sits shifted up/left inside the frame, so the top of
      // the first line renders clipped even though the frame is big enough.
      // Nothing ever scrolls this box on purpose; pin it at 0.
      const box = el.value.parentElement;
      if (box) {
        const unscroll = () => {
          if (box.scrollTop !== 0) box.scrollTop = 0;
          if (box.scrollLeft !== 0) box.scrollLeft = 0;
        };
        box.addEventListener("scroll", unscroll);
        unscroll();
      }
    });
    watch(
      () => props.object.content,
      () => {
        if (!isFocus.value) {
          el.value.innerHTML = props.object.content;
        }
      },
    );

    const activeMovable = computed(() => stageStore.activeMovable === props.object.id);
    const mousedown = (e) => {
      if (activeMovable.value && props.object.editing) {
        e.stopPropagation();
      }
    };

    return { el, liveTyping, isFocus, mousedown };
  },
};
</script>

<template>
  <AppObject :object="object">
    <template #menu="slotProps">
      <MenuContent v-bind="slotProps" v-model:active="active" :object="object" />
    </template>
    <template #render>
      <p
        ref="el"
        :style="object"
        class="has-text-centered"
        :contenteditable="object.editing"
        @keyup.delete.prevent.stop
        @keyup="liveTyping"
        @focus="isFocus = true"
        @blur="isFocus = false"
        @mousedown="mousedown"
      ></p>
    </template>
  </AppObject>
</template>

<style>
p[contenteditable="true"] {
  outline: none;
  cursor: text;
  white-space: nowrap;
}
</style>
