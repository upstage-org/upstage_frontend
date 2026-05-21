<script>
import { computed } from "vue";

export default {
  props: {
    src: { type: String, required: true },
    size: {
      type: [Number, String],
      default: 16,
    },
    width: [Number, String],
    height: [Number, String],
  },
  setup: (props) => {
    const path = computed(() => `/icons/${props.src}`);
    return { path };
  },
};
</script>

<template>
  <img :src="path" :style="{ width: (width ?? size) + 'px', height: (height ?? size) + 'px' }" />
</template>

<style lang="scss" scoped></style>
