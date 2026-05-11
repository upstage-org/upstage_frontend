<script>
import { ref } from "vue";
import { watchEffect } from "vue";
import Dropdown from "./Dropdown.vue";
import { titleCase } from "utils/common";

export default {
  components: { Dropdown },
  props: {
    modelValue: String,
    isUp: Boolean,
    data: Array,
  },
  emits: ["update:modelValue"],
  setup: (props, { emit }) => {
    const mediaType = ref(props.modelValue);
    watchEffect(() => {
      emit("update:modelValue", mediaType.value);
    });
    watchEffect(() => {
      if (props.modelValue === "media") {
        mediaType.value = null;
      } else {
        mediaType.value = props.modelValue;
      }
    });

    return { mediaType };
  },
  methods: { titleCase },
};
</script>

<template>
  <Dropdown
    v-model="mediaType"
    title="Type"
    :data="data ?? ['avatar', 'prop', 'backdrop', 'audio', 'video', 'curtain']"
    :render-label="titleCase"
    :is-up="isUp"
  />
</template>

<style></style>
