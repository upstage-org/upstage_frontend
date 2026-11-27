<script setup lang="ts">
const props = defineProps<{ modelValue?: string }>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const onColorEvent = (event: Event) => {
  const value = (event.target as HTMLInputElement).value;
  // Browsers differ in which events fire on <input type="color">:
  //  - Chromium (Chrome/Edge/Brave/Opera): emits `input` while the picker
  //    is open AND `change` when it closes.
  //  - Firefox: reliably emits only `change` (when the picker closes);
  //    `input` from the native dialog is historically unreliable.
  //  - Safari: emits `change` on close.
  // Listening to both events covers every major browser. Skip the emit
  // when nothing actually changed so Chromium doesn't double-fire.
  if (value !== props.modelValue) {
    emit("update:modelValue", value);
  }
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
