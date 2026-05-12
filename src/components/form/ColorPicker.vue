<script>
export default {
  props: { modelValue: String },
  emits: ["update:modelValue"],
  methods: {
    onColorEvent(event) {
      const value = event.target.value;
      // Browsers differ in which events fire on <input type="color">:
      //  - Chromium (Chrome/Edge/Brave/Opera): emits `input` while the picker
      //    is open AND `change` when it closes.
      //  - Firefox: reliably emits only `change` (when the picker closes);
      //    `input` from the native dialog is historically unreliable.
      //  - Safari: emits `change` on close.
      // Listening to both events covers every major browser. Skip the emit
      // when nothing actually changed so Chromium doesn't double-fire.
      if (value !== this.modelValue) {
        this.$emit("update:modelValue", value);
      }
    },
  },
};
</script>

<template>
  <input type="color" :value="modelValue" @input="onColorEvent" @change="onColorEvent" />
</template>

<style>
input[type="color"] {
  cursor: pointer;
  width: 48px;
  height: 48px;
  flex: none;
}
</style>
