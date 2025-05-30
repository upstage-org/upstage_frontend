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

<script>
import { computed } from "vue";
import { useStore } from "vuex";
export default {
  props: ["active", "object", "sliderMode"],
  emits: ["update:active"],
  setup: (props, { emit }) => {
    const store = useStore();
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

    const sendChangeOpacity = (e) => {
      store.dispatch("stage/shapeObject", {
        ...props.object,
        opacity: e.target.value,
      });
    };

    const calcMoveSpeed = (e) =>
      e.target.value == 0 ? 10000 : maxMoveSpeed / e.target.value;

    const sendChangeMoveSpeed = (e) => {
      store.dispatch("stage/shapeObject", {
        ...props.object,
        moveSpeed: calcMoveSpeed(e),
      });
    };

    const keepActive = () => {
      emit("update:active", true);
    };

    const sendChangeVolume = (e) => {
      store.dispatch("stage/shapeObject", {
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

    const isHolding = computed(
      () => props.object.id === store.state.user.avatarId,
    );
    const holdable = computed(() => ["avatar"].includes(props.object.type));
    const activeMovable = computed(() => store.getters["stage/activeMovable"]);
    const showSlider = computed(
      () =>
        (isHolding.value || !holdable.value) &&
        activeMovable.value === props.object.id,
    );

    return { keepActive, handleChange, value, isHolding, showSlider };
  },
};
</script>

<style>
.opacity-slider {
  position: absolute;
  transform: rotate(270deg) translateX(-100%);
  transform-origin: left;
}
</style>
