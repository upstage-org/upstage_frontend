<script setup lang="ts">
import { provide, ref, watchEffect } from "vue";

const props = withDefaults(
  defineProps<{
    id?: string;
    modelValue?: boolean;
    width?: string;
    height?: string;
    // ImagePicker passes a style object; the old declaration said String.
    styles?: Record<string, string> | null;
  }>(),
  {
    width: "80%",
    height: "unset",
    styles: null,
  },
);
const emit = defineEmits<{
  (e: "update:modelValue", visible: boolean): void;
}>();

const isActive = ref(props.modelValue);
watchEffect(() => (isActive.value = props.modelValue));

const setVisible = (visible: boolean) => {
  isActive.value = visible;
  emit("update:modelValue", visible);
};
const openModal = () => setVisible(true);
const closeModal = () => setVisible(false);

provide("openModal", openModal);
provide("closeModal", closeModal);
</script>

<template>
  <span @click="openModal">
    <slot name="trigger" />
  </span>
  <slot name="render" :open="openModal" />
  <teleport to="body">
    <div v-if="isActive" :id="id" class="modal is-active" :style="{ ...styles }">
      <div class="modal-background" @click="closeModal"></div>
      <div class="modal-card" :style="{ width, height }">
        <slot>
          <header v-if="$slots.header" class="modal-card-head">
            <p class="modal-card-title">
              <slot name="header" />
            </p>
            <button class="delete" aria-label="close" @click="closeModal"></button>
          </header>
          <section v-if="$slots.content" class="modal-card-body">
            <slot name="content" :close-modal="closeModal" />
          </section>
          <footer v-if="$slots.footer" class="modal-card-foot">
            <slot name="footer" :close-modal="closeModal" />
          </footer>
        </slot>
      </div>
    </div>
  </teleport>
</template>

<style>
.modal {
  z-index: 4000 !important;
}
</style>
