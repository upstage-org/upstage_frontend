<script>
export default {
  props: { modelValue: String },
  emits: ["update:modelValue"],
};
</script>

<template>
  <input
    type="color"
    :value="modelValue"
    @input="$emit('update:modelValue', $event.target.value)"
  />
</template>

<style>
input[type="color"] {
  cursor: pointer;
  width: 48px;
  height: 48px;
  flex: none;
}
</style>
