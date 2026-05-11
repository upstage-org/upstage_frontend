<script>
import { computed } from "vue";
import { useStore } from "vuex";
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
  if (object.type === "video") return "Avatar";
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
    const store = useStore();
    const canPlay = computed(() => store.getters["stage/canPlay"]);

    const stageSize = computed(() => store.getters["stage/stageSize"]);
    const config = computed(() => store.getters["stage/config"]);
    const objects = computed(() => store.getters["stage/objects"]);
    const drop = (e) => {
      const { object, isReal, nodrop } = JSON.parse(e.dataTransfer.getData("text"));
      if (isReal) {
        if (confirm("Are you sure you want to take this object off the stage?")) {
          store.dispatch("stage/deleteObject", object);
        }
      } else {
        if (e.clientX > 0 && e.clientY > 0 && !nodrop) {
          store
            .dispatch("stage/placeObjectOnStage", {
              ...object,
              x: e.clientX - 50 - stageSize.value.left,
              y: e.clientY - 50 - stageSize.value.top,
            })
            .then(({ id }) => {
              store.dispatch("stage/autoFocusMoveable", id);
            });
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
      animate(el.querySelector(".object"), {
        scale: 0,
        rotate: 180,
        duration: config.value.animateDuration,
        ease: "inOutQuad",
        onComplete: complete,
      });
    };

    const backdropColor = computed(() => store.state.stage.backdropColor);

    return {
      objects,
      drop,
      avatarEnter,
      avatarLeave,
      stageSize,
      backdropColor,
      canPlay,
      resolveType,
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
    >
      <Backdrop />
      <transition-group name="stage-avatars" :css="false" @enter="avatarEnter" @leave="avatarLeave">
        <component
          :is="resolveType(object)"
          v-for="object in objects"
          :id="object.id"
          :key="object.id"
          :object="object"
        />
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
}
</style>
