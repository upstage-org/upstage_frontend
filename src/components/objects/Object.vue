<template>
  <div ref="el" tabindex="0" @keyup.delete="deleteObject" @dblclick="hold" @click="openLink" :style="activeMovable
    ? {
      position: 'relative',
      'z-index': 1,
    }
    : {}
    ">
    <ContextMenu :pad-left="-stageSize.left" :pad-top="-stageSize.top" :pad-right="250" :opacity="0.8">
      <template #trigger>
        <div :style="{
          position: 'absolute',
          left: object.x + 'px',
          top: object.y + 'px',
          width: object.w + 'px',
          height: object.h + 'px',
          transform: `rotate(${object.rotate}deg)`,
        }">
          <OpacitySlider v-model:active="active" v-model:slider-mode="sliderMode" :object="object" />
          <QuickAction :object="object" v-model:active="active" />
          <Topping :object="object" v-model:active="active" />
        </div>
        <Moveable v-model:active="active" :controlable="controlable" :object="object as any">
          <div class="object" :class="{ 'link-hover-effect': hasLink && object.link?.effect }" :style="{
            width: '100%',
            height: '100%',
            cursor: controlable
              ? 'grab'
              : object.link && object.link.url
                ? 'pointer'
                : 'normal',
          }" @dragstart.prevent>
            <slot name="render">
              <video v-if="object.assetType?.name == 'video'" class="the-object-video" :src="object.url" ref="video"
                preload="auto" @ended="object.isPlaying = false" :loop="object.loop" @loadeddata="loadeddata"
                v-bind:id="'video' + object.id"></video>
              <Image v-else class="the-object" :src="src || ''" />
            </slot>
          </div>
        </Moveable>
      </template>
      <template #context="slotProps">
        <div v-if="isWearing || controlable">
          <slot name="menu" v-bind="slotProps" :slider-mode="sliderMode"
            :set-slider-mode="(mode: string) => (sliderMode = mode)" :keep-active="() => (active = true)" />
        </div>
      </template>
    </ContextMenu>
  </div>
</template>

<script setup lang="ts">
import { computed, provide, reactive, ref, watch } from "vue";
import Image from "components/Image.vue";
import ContextMenu from "components/ContextMenu.vue";
import OpacitySlider from "./OpacitySlider.vue";
import QuickAction from "./QuickAction.vue";
import Topping from "./Topping.vue";
import Moveable from "./Moveable.vue";
import { useUserStore } from "store/modules/user";
import { useStageStore } from "store/modules/stage";
import { ObjectProps } from "interfaces";

interface Props {
  object: ObjectProps;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'dblclick'): void;
}>();

// DOM refs
const el = ref<HTMLElement>();
const video = ref<HTMLVideoElement>();

// Pinia stores
const userStore = useUserStore();
const stageStore = useStageStore();

// Computed properties
const stageSize = computed(() => stageStore.stageSize);
const isHolding = computed(() => props.object.holder?.id === stageStore.session?.id);
const holdable = computed(() => ["avatar"].includes(props.object.type));
const canPlay = computed(() => stageStore.canPlay);
const controlable = computed(() => {
  return holdable.value
    ? isHolding.value
    : canPlay.value && !props.object.wornBy;
});
const activeMovable = computed(() => stageStore.activeMovable === props.object.id);
const isWearing = computed(() =>
  props.object.wornBy && stageStore.currentAvatar?.id === props.object.wornBy
);
const hasLink = computed(() =>
  !canPlay.value && props.object.link && props.object.link.url
);

// Local state
const active = ref(false);
const sliderMode = ref("opacity");
const beforeDragPosition = ref();

// Provide values to child components
provide("holdable", holdable);
provide("isWearing", isWearing);

// Frame animation for multi-frame objects
const frameAnimation = reactive({
  interval: null as NodeJS.Timeout | null,
  currentFrame: null as string | null,
});

// Watch for autoplay frames changes
if (props.object.multi) {
  watch(
    () => props.object.autoplayFrames,
    () => {
      const { autoplayFrames, frames, src } = props.object;
      if (frameAnimation.interval) {
        clearInterval(frameAnimation.interval);
      }
      if (autoplayFrames) {
        frameAnimation.currentFrame = src || null;
        frameAnimation.interval = setInterval(() => {
          if (frames && frameAnimation.currentFrame) {
            let nextFrame = frames.indexOf(frameAnimation.currentFrame) + 1;
            if (nextFrame >= frames.length) {
              nextFrame = 0;
            }
            frameAnimation.currentFrame = frames[nextFrame];
          }
        }, parseFloat(autoplayFrames) * 1000);
      }
    },
    { immediate: true }
  );
}

// Computed src for frame animation
const src = computed(() => {
  if (props.object.autoplayFrames && props.object.multi) {
    return frameAnimation.currentFrame;
  } else {
    return props.object.src;
  }
});

// Methods
const deleteObject = () => {
  if (controlable.value) {
    // TODO: Implement delete object logic
    // stageStore.deleteObject(props.object);
  }
};

const hold = () => {
  if (holdable.value && canPlay.value && !props.object.holder) {
    userStore.setAvatarId(props.object.id);
  }
};

const openLink = () => {
  if (hasLink.value && props.object.link) {
    const { url, blank } = props.object.link;
    window.open(url, blank ? "_blank" : "_self")?.focus();
  }
};

const synchronize = () => {
  if (props.object.isPlaying && video.value) {
    video.value.play();
  } else if (video.value) {
    video.value.pause();
  }
};

const loadeddata = () => {
  synchronize();
};

// Watchers
watch(
  () => props.object,
  () => {
    synchronize();
  }
);

watch(
  () => props.object.replayed,
  () => {
    if (video.value) {
      video.value.currentTime = 0;
    }
  }
);
</script>

<style lang="scss">
div[tabindex] {
  outline: none;
}

.object {
  z-index: 10;

  &.link-hover-effect {
    // transition: transform v-bind(transition);
  }

  &.link-hover-effect:hover {
    transform: scale(1.2) !important;
  }
}

.the-object-video {
  width: 100%;
  height: 100%;
}
</style>
