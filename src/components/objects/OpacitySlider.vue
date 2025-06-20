<template>
  <input class="opacity-slider slider is-fullwidth" :class="{
    'is-primary': sliderMode === 'opacity',
    'is-warning': sliderMode === 'volume',
    'is-danger': sliderMode === 'speed',
  }" step="0.01" min="0" max="1" :value="value" type="range" :style="{
    top: '-26px',
    left: '-15px',
    width: object.h + 'px',
  }" v-show="showSlider" @change="handleChange" @mousedown.stop="keepActive" @mouseover.stop="keepActive"
    @mouseup.stop="keepActive" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useUserStore } from "store/modules/user";
import { useStageStore } from "store/modules/stage";

interface ObjectProps {
  id: string;
  opacity: number;
  volume: number;
  moveSpeed: number;
  type: string;
  h: number;
  [key: string]: any;
}

interface Props {
  active: boolean;
  object: ObjectProps;
  sliderMode: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'update:active', value: boolean): void;
}>();

// Pinia stores
const userStore = useUserStore();
const stageStore = useStageStore();

const maxFrameSpeed = 50;
const maxMoveSpeed = 1000;

const value = computed(() => {
  switch (props.sliderMode) {
    case "speed":
      return props.object.moveSpeed == 0
        ? 0
        : maxMoveSpeed / props.object.moveSpeed;
    case "volume":
      return props.object.volume;
    default:
      return props.object.opacity;
  }
});

const sendChangeOpacity = (e: Event) => {
  const target = e.target as HTMLInputElement;
  stageStore.shapeObject({
    ...props.object,
    opacity: parseFloat(target.value),
  });
};

const calcMoveSpeed = (e: Event) => {
  const target = e.target as HTMLInputElement;
  return target.value == "0" ? 10000 : maxMoveSpeed / parseFloat(target.value);
};

const sendChangeMoveSpeed = (e: Event) => {
  stageStore.shapeObject({
    ...props.object,
    moveSpeed: calcMoveSpeed(e),
  });
};

const keepActive = () => {
  emit("update:active", true);
};

const sendChangeVolume = (e: Event) => {
  const target = e.target as HTMLInputElement;
  stageStore.shapeObject({
    ...props.object,
    volume: parseFloat(target.value),
  });
};

const handleChange = (e: Event) => {
  keepActive();
  switch (props.sliderMode) {
    case "opacity":
      sendChangeOpacity(e);
      break;
    case "speed":
      sendChangeMoveSpeed(e);
      break;
    case "volume":
      sendChangeVolume(e);
      break;
  }
};

const isHolding = computed(() => props.object.id === userStore.avatarId);
const holdable = computed(() => ["avatar"].includes(props.object.type));
const activeMovable = computed(() => stageStore.activeMovable);
const showSlider = computed(
  () =>
    (isHolding.value || !holdable.value) &&
    activeMovable.value === props.object.id,
);
</script>

<style>
.opacity-slider {
  position: absolute;
  transform: rotate(270deg) translateX(-100%);
  transform-origin: left;
}
</style>
