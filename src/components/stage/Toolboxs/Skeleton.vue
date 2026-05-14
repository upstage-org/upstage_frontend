<script>
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import { computed, ref } from "vue";
// Aliased: "Image" is a reserved HTML element name (vue/no-reserved-component-names).
import AppImage from "components/Image.vue";
import Icon from "components/Icon.vue";
import SavedDrawing from "./tools/Draw/SavedDrawing.vue";

export default {
  components: { AppImage, Icon, SavedDrawing },
  props: {
    data: {
      type: Object,
      required: true,
    },
    real: {
      type: Boolean,
      default: false,
    },
    ghost: {
      type: Boolean,
      default: false,
    },
    nodrop: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["dragstart"],
  setup: (props, { emit }) => {
    const stageStore = useStageStore();

    const dragstart = (e) => {
      e.dataTransfer.setData(
        "text",
        JSON.stringify({
          object: props.data,
          isReal: props.real,
          nodrop: props.nodrop,
        }),
      );
      document.getElementById("meeting-room")?.classList.add("disable-pointer");
      emit("dragstart", e);
    };

    const dragend = () => {
      document.getElementById("meeting-room")?.classList.remove("disable-pointer");
      if (props.real) {
        stageStore.SET_ACTIVE_MOVABLE(null);
      }
    };

    // Touch drag is handled globally by the `mobile-drag-drop` polyfill
    // initialised in main.ts: it synthesises the same `dragstart` / `drop`
    // events from `touchstart` / `touchmove` / `touchend` on
    // `[draggable=true]` elements, so iOS / Android Safari behaves the
    // same as desktop Chromium / Firefox without a per-component
    // `touchmove` handler. The previous half-implemented `touchmove` /
    // `touchend` here was missing `touchstart` (so position was NaN on
    // first move) and bypassed the actual drop target.

    const holdable = computed(() => ["avatar"].includes(props.data.type));
    const hold = () => {
      if (props.real && holdable.value && !props.data.holder) {
        useUserStore().setAvatarId(props.data.id);
      }
    };
    const showMovable = () => {
      if (
        props.real &&
        (!props.data.holder || !holdable.value || props.data.holder.id === stageStore.session)
      ) {
        stageStore.SET_ACTIVE_MOVABLE(props.data.id);
      }
    };

    const drop = (e) => {
      dropzone.value = false;
      const { object } = JSON.parse(e.dataTransfer.getData("text"));
      if (props.real) {
        stageStore.bringToFrontOf({
          front: object.id,
          back: props.data.id,
        });
      } else {
        // Re-order toolbox
        stageStore.REORDER_TOOLBOX({
          from: object,
          to: props.data,
        });
      }
    };

    const dropzone = ref(false);

    return {
      dragstart,
      dragend,
      hold,
      showMovable,
      drop,
      dropzone,
    };
  },
};
</script>

<template>
  <div
    class="is-flex is-align-items-center is-justify-content-center skeleton"
    :class="{ dropzone }"
    :title="data.name"
    draggable="true"
    @dragstart="dragstart"
    @dragend="dragend"
    @dragenter.prevent
    @dragover.prevent="dropzone = true"
    @dragleave.prevent="dropzone = false"
    @drop.prevent="drop"
    @dblclick="hold"
    @mouseenter="showMovable"
  >
    <slot v-if="$slots.default" />
    <SavedDrawing v-else-if="data.drawingId" :drawing="data" />
    <p
      v-else-if="data.type === 'text'"
      :style="{
        ...data,
        transform: `scale(${76 / data.w})`,
        'transform-origin': 0,
        'max-width': '100%',
      }"
      v-html="data.content"
    ></p>
    <div
      v-else-if="data.type === 'video'"
      :title="`Stream key: ${data.name}`"
      class="skeleton-meta"
    >
      <Icon src="stream.svg" size="36" />
      <span class="tag is-light is-block stream-key" style="color: rgba(0, 0, 0, 0.7)">{{
        data.name
      }}</span>
    </div>
    <div v-else-if="data.type === 'meeting'" class="skeleton-meta">
      <Icon src="meeting.svg" size="36" />
      <span class="tag is-light is-block stream-key">{{ data.name }}</span>
    </div>
    <a-tooltip v-else-if="!data.src" :title="data.displayName">
      <Icon src="meeting.svg" size="36" />
    </a-tooltip>
    <AppImage v-else class="skeleton-image" :src="data.src" />
    <Icon
      v-if="data.multi"
      class="is-multi"
      title="This is a multiframe avatar"
      src="multi-frame.svg"
    />
  </div>
</template>

<style scoped lang="scss">
.stream-key {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skeleton-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  max-width: 100%;
  max-height: 100%;
  overflow: hidden;
  gap: 2px;
}

.skeleton {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;

  > * {
    transition-duration: 0.25s;
  }

  :deep(.skeleton-image) {
    display: block;
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
  }

  :deep(.skeleton-image img) {
    width: 100%;
    height: 100%;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    object-position: center;
  }
}

.dropzone {
  background: repeating-radial-gradient(circle, green, green 10px, #007011 10px, #007011 20px);

  > * {
    transform: translateX(50%) !important;
  }
}
</style>
