<script>
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { isHoldableBoardObject, isLocalHoldOfBoardObject } from "@utils/common";
import { useUserStore } from "@stores/pinia/user";
export default {
  props: {
    active: Boolean,
    object: Object,
    sliderMode: String,
  },
  emits: ["update:active"],
  setup: (props, { emit }) => {
    const stageStore = useStageStore();
    const userStore = useUserStore();
    const maxMoveSpeed = 1000;
    const value = computed(() => {
      switch (props.sliderMode) {
        case "speed":
          return props.object.moveSpeed == 0 ? 0 : maxMoveSpeed / props.object.moveSpeed;
        case "volume":
          return props.object.volume;
        default:
          return props.object.opacity;
      }
    });

    const sendChangeOpacity = (e) => {
      stageStore.shapeObject({
        ...props.object,
        opacity: e.target.value,
      });
    };

    const calcMoveSpeed = (e) => (e.target.value == 0 ? 10000 : maxMoveSpeed / e.target.value);

    const sendChangeMoveSpeed = (e) => {
      stageStore.shapeObject({
        ...props.object,
        moveSpeed: calcMoveSpeed(e),
      });
    };

    const keepActive = () => {
      emit("update:active", true);
    };

    const sendChangeVolume = (e) => {
      stageStore.shapeObject({
        ...props.object,
        volume: e.target.value,
      });
    };

    const handleChange = (e) => {
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

    const isHolding = computed(() =>
      stageStore.canPlay
        ? isLocalHoldOfBoardObject(props.object, {
            localAvatarId: userStore.avatarId,
            localSessionId: stageStore.session,
            holder: props.object.holder,
          })
        : false,
    );
    const holdable = computed(() => isHoldableBoardObject(props.object));
    const activeMovable = computed(() => stageStore.activeMovable);
    const showSlider = computed(
      () => (isHolding.value || !holdable.value) && activeMovable.value === props.object.id,
    );

    return { keepActive, handleChange, value, isHolding, showSlider };
  },
};
</script>

<template>
  <input
    v-show="showSlider"
    class="opacity-slider slider is-fullwidth"
    :class="{
      'is-primary': sliderMode === 'opacity',
      'is-warning': sliderMode === 'volume',
      'is-danger': sliderMode === 'speed',
    }"
    step="0.01"
    min="0"
    max="1"
    :value="value"
    type="range"
    :style="{
      top: '-26px',
      left: '-15px',
      width: object.h + 'px',
    }"
    @change="handleChange"
    @mousedown.stop="keepActive"
    @mouseover.stop="keepActive"
    @mouseup.stop="keepActive"
    @touchstart.stop="keepActive"
    @touchend.stop="keepActive"
  />
</template>

<style>
.opacity-slider {
  position: absolute;
  transform: rotate(270deg) translateX(-100%);
  transform-origin: left;
}
</style>
