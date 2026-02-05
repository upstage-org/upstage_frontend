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
      class="slider is-fullwidth m-0 is-dark"
      step="1"
      min="1"
      max="200"
      type="range"
      v-model="size"
    />
  </div>
  <div
    class="drawing-tool"
    @click="toggleErase"
    :class="{
      active: mode === 'erase',
    }"
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

<script>
import { computed, onMounted, onUnmounted } from "vue";
import { useStore } from "vuex";
import { v4 as uuidv4 } from "uuid";
import ColorPicker from "components/form/ColorPicker.vue";
import Icon from "components/Icon.vue";
import { useDrawable } from "./Draw/composable";
import { DRAW_ACTIONS } from "utils/constants";

export default {
  components: { ColorPicker, Icon },
  setup: () => {
    const store = useStore();
    const stageSize = computed(() => store.getters["stage/stageSize"]);
    const isDrawing = computed(() => {
      return store.state.stage.preferences.isDrawing;
    });
    const { el, cursor, toggleErase, color, size, mode, clearCanvas } =
      useDrawable({
        onStrokeEnd(snapshot) {
          const ratio = 1 / stageSize.value.height;
          const strokeColor =
            typeof snapshot.color === "string" ? snapshot.color : "#000000";
          const command = {
            type: snapshot.type,
            size: snapshot.size * ratio,
            x: snapshot.x * ratio,
            y: snapshot.y * ratio,
            color: strokeColor,
            _sendId: uuidv4(),
            lines: (snapshot.lines || []).map((line) => ({
              x: line.x * ratio,
              y: line.y * ratio,
              fromX: line.fromX * ratio,
              fromY: line.fromY * ratio,
            })),
          };
          // Show stroke immediately with this stroke's color (optimistic update)
          store.commit("stage/UPDATE_WHITEBOARD", {
            type: DRAW_ACTIONS.NEW_LINE,
            command,
          });
          store.dispatch("stage/sendDrawWhiteboard", command);
          clearCanvas(true);
        },
      });

    onMounted(() => {
      store.commit("stage/UPDATE_IS_DRAWING", true);
    });

    onUnmounted(() => {
      store.commit("stage/UPDATE_IS_DRAWING", false);
    });

    const undo = () => {
      store.dispatch("stage/sendUndoWhiteboard");
      clearCanvas(true);
    };

    const clear = () => {
      store.dispatch("stage/sendClearWhiteboard");
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
