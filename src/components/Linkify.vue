<script lang="ts">
import { defineComponent, h } from "vue";
import { linkify } from "utils/common";

/**
 * Renders its slot text with URLs / e-mail addresses turned into links.
 *
 * `linkify()` HTML-escapes the text before adding anchors, so this is the
 * only place in the app that may bind that output as innerHTML. A render
 * function (rather than a one-shot `setup`) keeps the output in sync when
 * the slot text changes, e.g. an edited chat line.
 */
export default defineComponent({
  name: "Linkify",
  setup(_, { slots }) {
    const slotText = () =>
      (slots.default?.() ?? [])
        .map((vnode) => (typeof vnode.children === "string" ? vnode.children : ""))
        .join("");
    return () => h("span", { innerHTML: linkify(slotText()) });
  },
});
</script>
