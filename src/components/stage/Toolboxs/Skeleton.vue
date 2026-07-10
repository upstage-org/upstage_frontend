<script>
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useDragHoldShim } from "composables/index";
// Aliased: "Image" is a reserved HTML element name (vue/no-reserved-component-names).
import AppImage from "components/Image.vue";
import Icon from "components/Icon.vue";
import SavedDrawing from "./tools/Draw/SavedDrawing.vue";
import { isHoldableBoardObject, isLocalHoldOfBoardObject } from "@utils/common";

export default {
  components: { AppImage, Icon, SavedDrawing },
  // The root is now <a-tooltip>, but callers (e.g. Yourself.vue) pass class /
  // style expecting them to land on the inner `.skeleton` flex div — the way
  // they did when that div was the root. ant-design-vue spreads fallthrough
  // attrs onto the tooltip component instead, so without this the `p-2` /
  // `flex-direction: column` from Yourself.vue never reached the flex box and
  // its label rendered beside the video. Forward attrs to the flex div instead.
  inheritAttrs: false,
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
      // Emit before serialising the payload so parents (e.g. Yourself.vue)
      // can run publish-side effects while `props.data` is still the live
      // reactive object; `setData` snapshots JSON and would otherwise miss
      // updates that land in the same event tick.
      emit("dragstart", e);
      e.dataTransfer.setData(
        "text",
        JSON.stringify({
          object: props.data,
          isReal: props.real,
          nodrop: props.nodrop,
        }),
      );
      document.getElementById("meeting-room")?.classList.add("disable-pointer");
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
    //
    // Two touch-only helpers on top of the polyfill (desktop mouse DnD
    // never enters either):
    // - useDragHoldShim hides sub-slop finger jitter from the polyfill's
    //   zero-tolerance hold-to-drag abort listener, so a 300ms press
    //   reliably arms the drag on tablets.
    // - The `dragPending` class gives instant "keep holding" feedback from
    //   the polyfill's dnd-poly-dragstart-pending event; without it the
    //   first visible cue is the drag image appearing 300ms in.
    const skelEl = ref();
    useDragHoldShim(skelEl);

    const dragPending = ref(false);
    const setPending = () => (dragPending.value = true);
    // A hold that is released without moving fires neither
    // dnd-poly-dragstart-cancel nor dragend, so plain touchend/touchcancel
    // must also clear the highlight or it sticks forever.
    const clearPending = () => (dragPending.value = false);
    const pendingOn = ["dnd-poly-dragstart-pending"];
    const pendingOff = [
      "dnd-poly-dragstart-cancel",
      "dragstart",
      "dragend",
      "touchend",
      "touchcancel",
    ];
    onMounted(() => {
      const el = skelEl.value;
      if (!el) return;
      pendingOn.forEach((t) => el.addEventListener(t, setPending));
      pendingOff.forEach((t) => el.addEventListener(t, clearPending));
    });
    onBeforeUnmount(() => {
      const el = skelEl.value;
      if (!el) return;
      pendingOn.forEach((t) => el.removeEventListener(t, setPending));
      pendingOff.forEach((t) => el.removeEventListener(t, clearPending));
    });

    const holdable = computed(() => isHoldableBoardObject(props.data));
    const hold = () => {
      if (props.real && holdable.value && stageStore.canPlay && !props.data.holder) {
        useUserStore().setAvatarId(props.data.id);
      }
    };

    // Double-click / double-tap. Real (on-stage) items keep the existing
    // "hold this avatar" semantics. Toolbox items get placed at stage centre
    // — the touch equivalent of drag-to-stage, since hold-then-drag is
    // fiddly on tablets. `nodrop` tiles (backdrops, curtains, scenes) are
    // never placeable, mirroring the Board.vue drop guard.
    const dblclick = (e) => {
      if (props.real) {
        hold();
        return;
      }
      if (props.nodrop || !stageStore.canPlay) return;
      // Same hook a real drag fires first: MeetingObject/Yourself.vue
      // starts publishing the self-camera from @dragstart.
      emit("dragstart", e);
      const { width, height } = stageStore.stageSize;
      const placed = stageStore.placeObjectOnStage({
        ...props.data,
        x: width / 2 - 50,
        y: height / 2 - 50,
      });
      stageStore.autoFocusMoveable(placed.id);
    };
    const userStore = useUserStore();
    const isLocalHolder = () =>
      isLocalHoldOfBoardObject(props.data, {
        localAvatarId: userStore.avatarId,
        localSessionId: stageStore.session,
        holder: props.data.holder,
      });
    const showMovable = () => {
      // Holdable objects (avatars) may only get the manipulation frame when
      // THIS player holds them — an unheld avatar must not be movable from a
      // Depth-list hover any more than from an on-stage click (hold first,
      // then manipulate). Non-holdable objects (props/streams/etc.) keep the
      // hover frame whenever nobody-relevant blocks it.
      if (props.real && (holdable.value ? isLocalHolder() : true)) {
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

    // Single source for the item's hover tooltip so every kind of skeleton
    // (avatar/prop image, stream key, meeting/jitsi name) shows one consistent
    // styled tooltip instead of a mix of native `title` and ant tooltips.
    const tooltipTitle = computed(() => {
      const d = props.data;
      if (d.type === "video") return d.name ? `Stream key: ${d.name}` : "";
      if (!d.src && d.displayName) return d.displayName;
      return d.name ?? "";
    });

    return {
      dragstart,
      dragend,
      dblclick,
      showMovable,
      drop,
      dropzone,
      tooltipTitle,
      skelEl,
      dragPending,
    };
  },
};
</script>

<template>
  <!--
    One a-tooltip wraps the whole item so every skeleton kind shows the SAME
    styled tooltip (black bg, white text, rounded — ant defaults + color) rather
    than a mix of native `title` (light, square) and ant tooltips. ant-design-vue
    renders the child element directly (no wrapper) and merges event handlers, so
    the drag/drop/dblclick/mouseenter below are preserved.
  -->
  <a-tooltip :title="tooltipTitle" color="#000000" placement="top" :mouse-enter-delay="0.35">
    <div
      ref="skelEl"
      v-bind="$attrs"
      class="is-flex is-align-items-center is-justify-content-center skeleton"
      :class="{ dropzone, 'drag-pending': dragPending }"
      draggable="true"
      @dragstart="dragstart"
      @dragend="dragend"
      @dragenter.prevent
      @dragover.prevent="dropzone = true"
      @dragleave.prevent="dropzone = false"
      @drop.prevent="drop"
      @dblclick="dblclick"
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
      <div v-else-if="data.type === 'video'" class="skeleton-meta">
        <Icon src="stream.svg" size="36" />
        <span class="tag is-light is-block stream-key" style="color: rgba(0, 0, 0, 0.7)">{{
          data.name
        }}</span>
      </div>
      <!--
        Meetings get their own multi-stalk antenna so they read differently
        from individual streams (single-stalk meeting.svg, used by the
        !data.src fallback below) at toolbox/Depth size.
      -->
      <div v-else-if="data.type === 'meeting'" class="skeleton-meta">
        <!-- Same 36x48 as the Meeting panel tile (Meeting/index.vue) so the
             icon reads identically in the Depth list and the toolbox. -->
        <Icon src="meeting-room.svg" :width="36" :height="48" />
        <span class="tag is-light is-block stream-key">{{ data.name }}</span>
      </div>
      <div v-else-if="!data.src" class="skeleton-meta">
        <Icon src="meeting.svg" size="36" />
      </div>
      <AppImage v-else class="skeleton-image" :src="data.src" />
      <Icon v-if="data.multi" class="is-multi" src="multi-frame.svg" />
    </div>
  </a-tooltip>
</template>

<style scoped lang="scss">
.stream-key {
  // Pin the name label to the bottom so the icon is always the only in-flow
  // child of `.skeleton-meta` and stays vertically centred — this keeps every
  // icon (stream / meeting / jitsi) at the same height instead of some being
  // pushed up by the label below them.
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skeleton-meta {
  position: relative;
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
  // Reserve the strip the absolute .stream-key label sits on, so the label
  // never overlays the icon above it (it was covering the lower half of the
  // meeting icon's stalks in the Depth list). Applied unconditionally —
  // label or not — so all skeleton-meta icons stay at the same height.
  padding-bottom: 20px;
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

/* Touch hold-to-drag feedback: appears at touchstart (polyfill's
   dragstart-pending event) so the player knows to keep holding until the
   drag image takes over. The transition delay keeps quick taps flash-free. */
.drag-pending {
  outline: 3px solid #007011;
  outline-offset: -3px;
  transition: outline-color 0.15s ease 0.12s;
}
</style>
