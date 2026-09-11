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

    // Fit the object's frame to the text as it is typed. The frame
    // (object.w/h) is only measured once, when the text is first created in
    // TextTool.vue's saveText; editing on stage used to rely on the text
    // simply overflowing the fixed-size box, but `.object` now clips its
    // overflow (overflow: hidden in Object.vue), so without this the typed
    // text disappears past the frame edge. The fit is TWO-WAY: it grows for
    // new text and shrinks back when text is deleted — a stale oversized
    // frame sits invisibly over the stage and blocks access to objects
    // behind it. Exact fit is always right for texts: the font doesn't
    // scale with the frame, so a hand-stretched frame buys nothing.
    // +10 matches saveText.
    //
    // Two width modes (2026-09-11):
    //  - auto (no `wrap` flag): the frame shrink-wraps the widest line, so a
    //    long line typed in edit mode makes the text wider, never wraps.
    //  - wrap (`wrap: true`, set by Moveable's resizeEnd when the performer
    //    drags a handle on a text): the hand-set width is the wrap width.
    //    Lines fold inside it and only the height follows the text. Before,
    //    edit mode pinned `white-space: nowrap`, so a narrowed frame simply
    //    cut the line off, and the next keystroke snapped the frame back to
    //    the full line width.
    const fitFrameToText = () => {
      const node = el.value;
      if (!node) return {};
      const w = Number(props.object.w) || 0;
      const h = Number(props.object.h) || 0;
      const fit = {};
      const prevWidth = node.style.width;
      if (props.object.wrap) {
        // Measure at the frame width itself, not the DOM box: the frame is
        // tweened to its new size, so mid-animation the <p> is still the old
        // width. The <p> is as wide as the frame (block inside a 100% box).
        node.style.width = `${w}px`;
        const neededH = node.offsetHeight + 10;
        node.style.width = prevWidth;
        if (neededH !== h) fit.h = neededH;
        return fit;
      }
      // Measure the text's INTRINSIC size, not the scroll box: scrollWidth/
      // scrollHeight are clamped to the clientWidth/Height of the p (which
      // fills the frame), so "scrollWidth + 10 > w" held on every keystroke
      // once the frame tracked instantly and the frame ratcheted +10 per
      // keyup forever. width: max-content shrink-wraps the p (and its
      // <div> lines) to the widest line for one synchronous measure.
      node.style.width = "max-content";
      // 40px floor so a fully-emptied text doesn't collapse into an
      // ungrabbable sliver.
      const neededW = Math.max(node.offsetWidth + 10, 40);
      const neededH = node.offsetHeight + 10;
      node.style.width = prevWidth;
      if (neededW !== w) fit.w = neededW;
      if (neededH !== h) fit.h = neededH;
      return fit;
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

    // A hand resize (Moveable's resizeEnd) sets the wrap width; the height it
    // dragged out is replaced by the wrapped text's own height, otherwise
    // the lines that fold down are clipped by the frame (`.object` hides its
    // overflow). Only the client holding the handles does this — every
    // viewer sees the same `w` arrive, and if each re-fitted and published,
    // one resize would echo around the room. flush: "post" so the <p> has
    // already lost `is-nowrap` (first resize of an auto-width text) when
    // the wrapped height is measured; a pre-flush measure still sees the
    // unwrapped, single-line-per-<div> height.
    watch(
      () => props.object.w,
      (w, oldW) => {
        if (w === oldW || !props.object.wrap || !activeMovable.value) return;
        const fit = fitFrameToText();
        if (fit.h !== undefined) {
          stageStore.shapeObject({ ...props.object, ...fit });
        }
      },
      { flush: "post" },
    );

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
        :class="{ 'is-nowrap': object.editing && !object.wrap }"
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
}
/* Auto-width edit mode: a line grows the frame instead of folding (see
   fitFrameToText). Dropped once the frame has been resized by hand. */
p.is-nowrap {
  white-space: nowrap;
}
</style>
