<script>
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import ColorPicker from "components/form/ColorPicker.vue";
import Icon from "components/Icon.vue";
import { useDrawable } from "./Draw/composable";

export default {
  components: { ColorPicker, Icon },
  setup: () => {
    const stageStore = useStageStore();
    const stageSize = computed(() => stageStore.stageSize);
    const isDrawing = computed(() => {
      return stageStore.preferences.isDrawing;
    });
    const { el, cursor, toggleErase, color, size, alpha, mode, history, clearCanvas } =
      useDrawable();

    onMounted(() => {
      stageStore.UPDATE_IS_DRAWING(true);
    });

    onUnmounted(() => {
      stageStore.UPDATE_IS_DRAWING(false);
    });

    watch(history, (val) => {
      if (history.length) {
        let command = val[0];
        const ratio = 1 / stageSize.value.height;
        command = {
          ...command,
          size: command.size * ratio,
          x: command.x * ratio,
          y: command.y * ratio,
          lines: command.lines.map((line) => ({
            x: line.x * ratio,
            y: line.y * ratio,
            fromX: line.fromX * ratio,
            fromY: line.fromY * ratio,
          })),
        };
        stageStore.sendDrawWhiteboard(command);
        clearCanvas(true);
      }
    });

    const undo = () => {
      stageStore.sendUndoWhiteboard();
      clearCanvas(true);
    };

    const clear = () => {
      stageStore.sendClearWhiteboard();
      clearCanvas(true);
    };

    return {
      isDrawing,
      color,
      size,
      alpha,
      el,
      clear,
      undo,
      toggleErase,
      mode,
      cursor,
      stageSize,
    };
  },
};
</script>

<template>
  <canvas
    ref="el"
    class="drawing"
    :width="stageSize.width"
    :height="stageSize.height"
    :style="{
      cursor,
      top: stageSize.top + 'px',
      left: stageSize.left + 'px',
    }"
  >
    Your browser does not support the HTML5 canvas tag.
  </canvas>
  <div class="drawing-tool">
    <div class="icon is-large">
      <ColorPicker v-model="color" />
    </div>
    <span class="tag is-light is-block">{{ $t("colour") }}</span>
  </div>
  <div class="drawing-tool slider-tile" style="width: 200px">
    <div class="size-preview">
      <div
        class="dot"
        :style="{
          width: size + 'px',
          height: size + 'px',
          'background-color': color,
        }"
        @click="mode = 'draw'"
      />
    </div>
    <input
      v-model="size"
      class="slider is-fullwidth m-0 is-dark"
      step="1"
      min="1"
      max="200"
      type="range"
    />
    <span class="tag is-light is-block">{{ $t("size") }}</span>
  </div>
  <div class="drawing-tool slider-tile" style="width: 200px">
    <div class="size-preview">
      <div
        class="dot"
        :style="{
          width: size + 'px',
          height: size + 'px',
          'background-color': color,
          opacity: alpha,
        }"
        @click="mode = 'draw'"
      />
    </div>
    <input
      v-model.number="alpha"
      class="slider is-fullwidth m-0 is-dark"
      step="0.05"
      min="0"
      max="1"
      type="range"
    />
    <span class="tag is-light is-block">{{ $t("opacity") }}</span>
  </div>
  <div
    class="drawing-tool"
    :class="{
      active: mode === 'erase',
    }"
    @click="toggleErase"
  >
    <div class="icon is-large">
      <Icon size="36" src="erase.svg" />
    </div>
    <span class="tag is-light is-block">{{ $t("erase") }}</span>
  </div>
  <div class="drawing-tool" @click="undo">
    <div class="icon is-large">
      <Icon size="36" src="undo.svg" />
    </div>
    <span class="tag is-light is-block">{{ $t("undo") }}</span>
  </div>
  <div class="drawing-tool" @click="clear">
    <div class="icon is-large">
      <Icon size="36" src="clear.svg" />
    </div>
    <span class="tag is-light is-block">{{ $t("clear") }}</span>
  </div>
</template>

<style lang="scss" scoped>
.drawing {
  position: fixed;
  z-index: 1000;
  /* Tells the browser this element handles its own gestures.
     Without this, iOS Safari and Chrome on Android interpret the
     first touchmove on the canvas as a page-pan or pinch-zoom,
     so the pointer events never fire and the player only ever
     gets a single dot from the initial touchstart. */
  touch-action: none;
}
.drawing-tool {
  z-index: 1001;
  position: relative;
  vertical-align: top;
}
/* The size and opacity tiles hold edge-to-edge sliders; without a gap
   the two ranges visually merge into one long track. */
.slider-tile + .slider-tile {
  margin-left: 12px;
}
.size-preview {
  display: flex;
  width: 100%;
  height: 48px;
}
.dot {
  margin: auto;
  background-color: black;
  border-radius: 100%;
}
</style>
