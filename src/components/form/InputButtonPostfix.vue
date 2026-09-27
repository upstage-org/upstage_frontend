<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  icon?: string;
  loading?: boolean;
  modelValue?: string | number;
}>();

defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "ok", value: string | undefined): void;
}>();

const el = ref<HTMLInputElement>();
</script>

<template>
  <div class="control has-icons-right is-fullwidth">
    <input
      ref="el"
      class="input is-rounded"
      :value="modelValue"
      v-bind="$attrs"
      @input="(e) => $emit('update:modelValue', (e.target as HTMLInputElement).value)"
      @keyup.enter="(e) => $emit('ok', (e.target as HTMLInputElement).value)"
    />
    <button
      class="icon is-right clickable button is-primary is-rounded"
      :class="{ 'is-loading': loading }"
      :disabled="loading"
      @click="$emit('ok', el?.value)"
    >
      <slot name="icon">
        <i :class="icon"></i>
      </slot>
    </button>
  </div>
</template>

<style scoped>
input.is-rounded {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
</style>
