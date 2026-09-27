<script setup lang="ts">
import { onMounted, ref, watch } from "vue";

const props = defineProps<{ modelValue?: string | number }>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "ref", element: HTMLTextAreaElement): void;
  (e: "submit"): void;
}>();

const el = ref<HTMLTextAreaElement>();
onMounted(() => {
  emit("ref", el.value as HTMLTextAreaElement);
});
const handleInput = (e: Event) => {
  emit("update:modelValue", (e.target as HTMLTextAreaElement).value);
};
watch(
  () => props.modelValue,
  () => {
    const textarea = el.value as HTMLTextAreaElement;
    textarea.style.height = "40px";
    if (props.modelValue && textarea.scrollHeight) {
      textarea.style.height = textarea.scrollHeight + "px";
    }
  },
);
const submit = (e: KeyboardEvent) => {
  if (!e.shiftKey) {
    e.preventDefault();
    emit("submit");
  }
};
</script>

<template>
  <textarea
    ref="el"
    rows="1"
    v-bind="$attrs"
    class="textarea"
    :value="modelValue"
    @input="handleInput"
    @keydown.enter="submit"
  ></textarea>
</template>

<style scoped>
textarea {
  padding: 8px;
  resize: none;
  overflow: hidden;
}
textarea[rows="1"] {
  height: 40px;
}
</style>
