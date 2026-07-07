<script>
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { useDrawable } from "./composable";
import ColorPicker from "components/form/ColorPicker.vue";
import Icon from "components/Icon.vue";
import ContextMenu from "components/ContextMenu.vue";
import Skeleton from "../../Skeleton.vue";
import { v4 as uuidv4 } from "uuid";

export default {
  components: { Skeleton, ColorPicker, Icon, ContextMenu },
  setup: () => {
    const stageStore = useStageStore();
    const stageSize = computed(() => stageStore.stageSize);
    const drawings = computed(() => stageStore.board.drawings);
    const isDrawing = computed(() => {
      return stageStore.preferences.isDrawing;
    });
    const {
      el,
      cursor,
      getDrawedArea,
      clearCanvas,
      undo,
      toggleErase,
      color,
      size,
      mode,
      history,
    } = useDrawable();
    const create = () => {
      stageStore.SET_ACTIVE_MOVABLE(null);
      stageStore.UPDATE_IS_DRAWING(true);
      clearCanvas(true);
    };
    const cancel = () => {
      stageStore.UPDATE_IS_DRAWING(false);
    };
    const save = (type) => {
      const area = getDrawedArea();
      // Leave drawing mode BEFORE placing: addDrawing auto-focuses the new
      // object's moveable frame, and autoFocusMoveable is a no-op while
      // `preferences.isDrawing` is still true.
      cancel();
      if (area) {
        const drawingId = uuidv4();
        const commands = [...history];
        stageStore.addDrawing({
          ...area,
          commands,
          type,
          drawingId,
        });
      }
    };

    const deleteDrawingPermanently = (drawing) => {
      stageStore.POP_DRAWING(drawing.drawingId);
      stageStore.objects
        .filter((o) => o.drawingId === drawing.drawingId)
        .forEach((o) => {
          stageStore.deleteObject(o);
        });
    };

    // Removes every placed drawing object from the stage; the saved
    // drawings stay in this strip for re-placing (unlike delete permanently).
    const clearAll = () => stageStore.clearStageObjectsOfKind("drawing");

    return {
      clearAll,
      isDrawing,
      drawings,
      color,
      size,
      create,
      save,
      cancel,
      el,
      clearCanvas,
      undo,
      toggleErase,
      mode,
      cursor,
      stageSize,
      deleteDrawingPermanently,
    };
  },
};
</script>

<template>
  <canvas
    v-show="isDrawing"
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
  <template v-if="isDrawing">
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
    <div class="drawing-tool" @click="clearCanvas(true)">
      <div class="icon is-large">
        <Icon size="36" src="clear.svg" />
      </div>
      <span class="tag is-light is-block">{{ $t("clear") }}</span>
    </div>
    <div class="drawing-tool" @click="save('avatar')">
      <div class="icon is-large">
        <Icon size="24" src="check.svg" />
        &nbsp;
        <Icon size="24" src="avatar.svg" />
      </div>
      <span class="tag is-light is-block">{{ $t("save_as_avatar") }}</span>
    </div>
    <div class="drawing-tool" @click="save('prop')">
      <div class="icon is-large">
        <Icon size="24" src="check.svg" />
        &nbsp;
        <Icon size="24" src="prop.svg" />
      </div>
      <span class="tag is-light is-block">{{ $t("save_as_prop") }}</span>
    </div>
    <div class="drawing-tool" @click="cancel">
      <div class="icon is-large">
        <Icon size="36" src="cancel.svg" />
      </div>
      <span class="tag is-light is-block">{{ $t("cancel") }}</span>
    </div>
  </template>
  <template v-else>
    <div @click="clearAll">
      <div class="icon is-large">
        <Icon size="36" src="clear.svg" />
      </div>
      <span class="tag is-light is-block">{{ $t("clear") }}</span>
    </div>
    <div class="is-pulled-left" @click="create">
      <div class="icon is-large">
        <Icon src="new.svg" size="36" />
      </div>
      <span class="tag is-light is-block">{{ $t("new_drawing") }}</span>
    </div>
    <div v-for="drawing in drawings" :key="drawing">
      <ContextMenu>
        <template #trigger>
          <Skeleton :data="drawing" />
        </template>
        <template #context>
          <a class="panel-block has-text-danger" @click="deleteDrawingPermanently(drawing)">
            <span class="panel-icon">
              <Icon src="remove.svg" />
            </span>
            <span>{{ $t("delete_permanently") }}</span>
          </a>
        </template>
      </ContextMenu>
    </div>
  </template>
</template>

<style lang="scss" scoped>
.drawing {
  position: fixed;
  z-index: 1000;
  background-color: hsla(142, 52%, 96%, 0.8);
  /* Required for pointer-event drawing on touch screens — see the
     mirror comment in stage/Toolboxs/tools/WhiteboardTools.vue and
     the pointer-events refactor in Draw/composable.ts. Without
     this, iOS / Android browsers swallow the first touchmove as a
     page-pan gesture and the player only gets a dot. */
  touch-action: none;
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
