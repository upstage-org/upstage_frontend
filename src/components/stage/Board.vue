<template>
  <section id="live-stage" class="hero bg-cover is-fullheight" :style="{ 'background-color': backdropColor }">
    <div id="board" @dragenter.prevent @dragover.prevent @drop.prevent="handleDrop" :style="{
      width: stageSize.width + 'px',
      height: stageSize.height + 'px',
      transform:
        'translateX(' +
        stageSize.left +
        'px) translateY(' +
        stageSize.top +
        'px)',
    }">
      <Backdrop />
      <transition-group name="stage-avatars" :css="false" @enter="avatarEnter" @leave="avatarLeave">
        <component v-for="object in objects" :id="object.id" :key="object.id"
          :is="object.drawingId ? 'drawing' : object.type == 'video' ? 'avatar' : object.type ?? 'avatar'"
          :object="object" />
      </transition-group>
    </div>
  </section>
  <Whiteboard />
  <Curtain />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStageStore } from "stores/stage";
import Avatar from "components/objects/Avatar/index.vue";
import Drawing from "components/objects/Drawing.vue";
import Meeting from "components/objects/MeetingObject/index.vue";
import Jitsi from "components/objects/MeetingObject/Jitsi.vue";
import Text from "components/objects/Text.vue";
import Curtain from "components/stage/Curtain.vue";
import Whiteboard from "components/stage/Whiteboard.vue";
import Image from "../Image.vue";
import { animate } from "animejs";
import Backdrop from "./Backdrop.vue";

const store = useStageStore();

const { stageSize, objects, backdropColor, canPlay, config } = store;

const handleDrop = async (e: DragEvent) => {
  if (!e.dataTransfer) return;

  const { object, isReal, nodrop } = JSON.parse(
    e.dataTransfer.getData("text"),
  );

  if (isReal) {
    if (confirm("Are you sure you want to take this object off the stage?")) {
      await store.deleteObject(object);
    }
  } else {
    if (e.clientX > 0 && e.clientY > 0 && !nodrop) {
      const { id } = await store.placeObjectOnStage({
        ...object,
        x: e.clientX - 50 - stageSize.left,
        y: e.clientY - 50 - stageSize.top,
      });
      await store.autoFocusMoveable(id);
    }
  }
};

const avatarEnter = (el: Element, complete: () => void) => {
  const objectElement = el.querySelector(".object");
  if (!objectElement) return;

  animate(objectElement as HTMLElement, {
    scale: [0, 1],
    translateY: [-200, 0],
    duration: config.animateDuration,
    ease: "inOutQuad",
    onComplete: complete,
  });
};

const avatarLeave = (el: Element, complete: () => void) => {
  const objectElement = el.querySelector(".object");
  if (!objectElement) return;

  animate(objectElement as HTMLElement, {
    scale: 0,
    rotate: 180,
    duration: config.animateDuration,
    ease: "inOutQuad",
    onComplete: complete,
  });
};
</script>

<style scoped>
#board {
  position: fixed;
  background-size: cover;
  overflow: hidden;
}
</style>
