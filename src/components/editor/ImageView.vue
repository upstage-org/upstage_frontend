<script setup lang="ts">
/**
 * How an image is shown inside `RichTextEditor`: the picture itself, and when
 * it is selected, four corner handles that resize it (proportions kept, as
 * TinyMCE did). Double-click or right-click asks the editor to open the image
 * properties dialog through the extension's `onEditImage` option.
 */
import { NodeViewWrapper, nodeViewProps } from "@tiptap/vue-3";
import { computed, onBeforeUnmount, ref } from "vue";
import { MIN_IMAGE_SIZE, type ImageEditRequest, sizeFromStyle, withoutSize } from "./richText";

const props = defineProps(nodeViewProps);

type Corner = "nw" | "ne" | "sw" | "se";
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];

const img = ref<HTMLImageElement | null>(null);
/** Size while a handle is dragged; `null` between drags. */
const dragging = ref<{ width: number; height: number } | null>(null);

const size = computed(() => {
  const styled = sizeFromStyle(props.node.attrs.style as string | null);
  const width = Number(props.node.attrs.width) || styled.width;
  const height = Number(props.node.attrs.height) || styled.height;
  return { width, height };
});

const imgStyle = computed(() => {
  if (dragging.value)
    return { width: `${dragging.value.width}px`, height: `${dragging.value.height}px` };
  return undefined;
});

const editable = computed(() => props.editor.isEditable);

const requestEdit = (event: Event) => {
  if (!editable.value) return;
  event.preventDefault();
  const onEditImage = (props.extension.options as { onEditImage?: (r: ImageEditRequest) => void })
    .onEditImage;
  const pos = props.getPos();
  if (onEditImage && typeof pos === "number") onEditImage({ pos });
};

let stop: (() => void) | null = null;

const startResize = (corner: Corner, event: MouseEvent) => {
  if (!editable.value || !img.value) return;
  // Not a text selection, not a ProseMirror node drag.
  event.preventDefault();
  event.stopPropagation();
  const element = img.value;
  // Start from the size on screen, and keep the proportions the picture
  // really has: both attributes when both are set, else its natural size.
  // Mixing an attribute width with a rendered height (a width-only image
  // squeezed by max-width) produced a wrong ratio and a squashed save.
  const rect = element.getBoundingClientRect();
  const startWidth =
    Math.round(rect.width) || size.value.width || element.offsetWidth || element.naturalWidth;
  const startHeight =
    Math.round(rect.height) || size.value.height || element.offsetHeight || element.naturalHeight;
  if (!startWidth || !startHeight) return;
  const ratio =
    size.value.width && size.value.height
      ? size.value.height / size.value.width
      : element.naturalWidth && element.naturalHeight
        ? element.naturalHeight / element.naturalWidth
        : startHeight / startWidth;
  const direction = corner.endsWith("w") ? -1 : 1;
  const startX = event.clientX;

  const move = (moveEvent: MouseEvent) => {
    const width = Math.max(
      MIN_IMAGE_SIZE,
      Math.round(startWidth + (moveEvent.clientX - startX) * direction),
    );
    dragging.value = { width, height: Math.max(1, Math.round(width * ratio)) };
  };
  const finish = () => {
    stop?.();
    const result = dragging.value;
    dragging.value = null;
    if (!result || result.width === startWidth) return;
    props.updateAttributes({
      width: result.width,
      height: result.height,
      style: withoutSize(props.node.attrs.style as string | null),
    });
  };
  stop = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", finish);
    stop = null;
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", finish);
};

onBeforeUnmount(() => stop?.());
</script>

<template>
  <NodeViewWrapper
    as="span"
    class="rich-text-image"
    :class="{ 'is-selected': selected && editable, 'is-resizing': dragging }"
    data-drag-handle
  >
    <img
      ref="img"
      :src="node.attrs.src"
      :alt="node.attrs.alt ?? undefined"
      :title="node.attrs.title ?? undefined"
      :width="size.width || undefined"
      :height="size.height || undefined"
      :style="imgStyle ?? node.attrs.style ?? undefined"
      draggable="false"
      @dblclick="requestEdit"
      @contextmenu="requestEdit"
    />
    <template v-if="selected && editable">
      <span
        v-for="corner in CORNERS"
        :key="corner"
        class="rich-text-image-handle"
        :class="`is-${corner}`"
        :data-corner="corner"
        role="presentation"
        @mousedown="startResize(corner, $event)"
      />
    </template>
    <span v-if="dragging" class="rich-text-image-size">
      {{ dragging.width }} × {{ dragging.height }}
    </span>
  </NodeViewWrapper>
</template>

<style lang="less">
.rich-text-image {
  position: relative;
  display: inline-block;
  max-width: 100%;
  line-height: 0;
  vertical-align: baseline;

  img {
    max-width: 100%;
    height: auto;
    vertical-align: baseline;
  }

  &.is-selected img {
    outline: 2px solid #007011;
  }

  &.is-resizing img {
    max-width: none;
  }
}

.rich-text-image-handle {
  position: absolute;
  z-index: 1;
  width: 10px;
  height: 10px;
  border: 1px solid #fff;
  background: #007011;
  box-shadow: 0 0 0 1px #007011;

  &.is-nw {
    top: -5px;
    left: -5px;
    cursor: nwse-resize;
  }
  &.is-ne {
    top: -5px;
    right: -5px;
    cursor: nesw-resize;
  }
  &.is-sw {
    bottom: -5px;
    left: -5px;
    cursor: nesw-resize;
  }
  &.is-se {
    bottom: -5px;
    right: -5px;
    cursor: nwse-resize;
  }
}

.rich-text-image-size {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 11px;
  line-height: 1.4;
  pointer-events: none;
}
</style>
