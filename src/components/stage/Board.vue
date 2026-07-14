<script>
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useStageStore } from "@stores/pinia/stage";
import { isStreamPlaybackBoardType } from "@utils/common";
import Avatar from "components/objects/Avatar/index.vue";
import Drawing from "components/objects/Drawing.vue";
import Meeting from "components/objects/MeetingObject/index.vue";
import Jitsi from "components/objects/MeetingObject/Jitsi.vue";
// Aliased: "Text" and "Image" are reserved HTML element names
// (vue/no-reserved-component-names). Renaming the registration keys would
// break the previous `<component :is="object.type">` lookup (Vue resolves
// 'text'/'image' case-insensitively to the registered key), so resolution
// now goes through resolveType() which maps object.type to the alias.
import TextObject from "components/objects/Text.vue";
import Curtain from "components/stage/Curtain.vue";
import Whiteboard from "components/stage/Whiteboard.vue";
import AppImage from "../Image.vue";
import { animate } from "animejs";
import Backdrop from "./Backdrop.vue";
import {
  DEFAULT_EXIT_ANIMATION,
  DEFAULT_EXIT_SPEED,
  runRemovalAnimation,
} from "./removalAnimations";

const TYPE_TO_COMPONENT = {
  drawing: "Drawing",
  avatar: "Avatar",
  prop: "Prop",
  text: "TextObject",
  image: "AppImage",
  meeting: "Meeting",
  jitsi: "Jitsi",
};

const resolveType = (object) => {
  if (object.drawingId) return "Drawing";
  if (isStreamPlaybackBoardType(object.type)) return "Avatar";
  return TYPE_TO_COMPONENT[object.type] || "Avatar";
};

export default {
  components: {
    Avatar,
    Prop: Avatar,
    Drawing,
    TextObject,
    Curtain,
    Whiteboard,
    AppImage,
    Backdrop,
    Meeting,
    Jitsi,
  },
  setup: () => {
    const stageStore = useStageStore();
    const { canPlay, stageSize, config, objects } = storeToRefs(stageStore);
    const drop = (e) => {
      const { object, isReal, nodrop } = JSON.parse(e.dataTransfer.getData("text"));
      if (isReal) {
        if (confirm("Are you sure you want to take this object off the stage?")) {
          stageStore.deleteObject(object);
        }
      } else {
        if (e.clientX > 0 && e.clientY > 0 && !nodrop) {
          // `placeObjectOnStage` is synchronous and returns the placed
          // object directly — no .then() wrapping needed.
          const placed = stageStore.placeObjectOnStage({
            ...object,
            x: e.clientX - 50 - stageSize.value.left,
            y: e.clientY - 50 - stageSize.value.top,
          });
          stageStore.autoFocusMoveable(placed.id);
        }
      }
    };

    const avatarEnter = (el, complete) => {
      animate(el.querySelector(".object"), {
        scale: [0, 1],
        translateY: [-200, 0],
        duration: config.value.animateDuration,
        ease: "inOutQuad",
        onComplete: complete,
      });
    };
    const avatarLeave = (el, complete) => {
      // Per-assignment exit settings ride the object and are mirrored onto
      // the rendered `.object` div as data attributes (Object.vue) — the
      // store has already dropped the object by the time this leave hook
      // runs, so the DOM snapshot is the only place left to read them.
      // Objects without their own setting (text, drawings) disappear
      // instantly, same as the default for media.
      const dataset = el.querySelector?.(".object")?.dataset ?? {};
      const animation = dataset.exitAnimation || DEFAULT_EXIT_ANIMATION;
      const speed = Number(dataset.exitSpeed);
      const duration = speed > 0 ? speed : DEFAULT_EXIT_SPEED;
      runRemovalAnimation(animation, el, complete, { duration });
    };

    const backdropColor = computed(() => stageStore.backdropColor);
    const meetingRefreshKey = computed(() => stageStore.meetingRefreshKey);

    const onBoardPointerDown = (e) => {
      if (!canPlay.value || e.target.id !== "board") return;
      // Deselect only — do NOT release the avatar hold on an empty-stage click.
      // The hold persists until the player holds a different avatar
      // (double-click) or picks "Release" from the avatar context menu, so they
      // keep speaking as their avatar while moving props/other objects.
      stageStore.SET_ACTIVE_MOVABLE(null);
    };

    // Remount embedded conference tiles when the user hits "Refresh
    // meeting" so a stuck/failed iframe reloads from scratch.
    const boardObjectKey = (object) =>
      object.type === "meeting" ? `${object.id}-${meetingRefreshKey.value}` : object.id;

    return {
      objects,
      drop,
      avatarEnter,
      avatarLeave,
      stageSize,
      backdropColor,
      canPlay,
      resolveType,
      boardObjectKey,
      onBoardPointerDown,
    };
  },
};
</script>

<template>
  <section
    id="live-stage"
    class="hero bg-cover is-fullheight"
    :style="{ 'background-color': backdropColor }"
  >
    <div
      id="board"
      data-testid="board"
      :style="{
        width: stageSize.width + 'px',
        height: stageSize.height + 'px',
        transform: 'translateX(' + stageSize.left + 'px) translateY(' + stageSize.top + 'px)',
      }"
      @dragenter.prevent
      @dragover.prevent
      @drop.prevent="drop"
      @mousedown="onBoardPointerDown"
    >
      <Backdrop />
      <!--
        Each object is wrapped in a plain div so the transition-group child is
        a single element root. The object components bottom out in
        ContextMenu.vue, whose template is a fragment (trigger div + teleport)
        — Vue cannot animate a fragment-rooted component inside a transition
        ("renders non-element root node that cannot be animated"), so the
        enter/leave hooks silently never ran and objects blinked out with no
        exit animation. The wrapper is layout-neutral: everything the object
        components render is absolutely positioned against #board.
      -->
      <transition-group name="stage-avatars" :css="false" @enter="avatarEnter" @leave="avatarLeave">
        <div v-for="object in objects" :key="boardObjectKey(object)">
          <component :is="resolveType(object)" :id="object.id" :object="object" />
        </div>
      </transition-group>
    </div>
  </section>
  <Whiteboard />
  <Curtain />
</template>

<style scoped>
#board {
  position: fixed;
  background-size: cover;
  overflow: hidden;
  /* Single-finger pans starting on the stage must not scroll the page
     ("mysterious margins" while trying to move objects on a tablet);
     two-finger pinch-zoom stays available for the audience. */
  touch-action: pinch-zoom;
}
</style>
