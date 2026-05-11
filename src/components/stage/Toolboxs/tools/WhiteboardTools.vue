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
    const { el, cursor, toggleErase, color, size, mode, history, clearCanvas } = useDrawable();

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
      'pointer-events': none,
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
  <div class="drawing-tool" style="width: 200px">
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
}
.drawing-tool {
  z-index: 1001;
  position: relative;
  vertical-align: top;
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
