<script setup lang="ts">
import { computed, ref, useAttrs } from "vue";
import { coerceNumber } from "utils/common";

const props = withDefaults(
  defineProps<{
    required?: boolean;
    requiredMessage?: string;
    modelValue?: string | number;
    label?: string;
    type?: string;
    placeholder?: string;
    left?: string;
    right?: string;
    horizontal?: boolean;
    help?: string;
    error?: string;
    touched?: boolean;
    noTrim?: boolean;
  }>(),
  {
    required: false,
    type: "text",
    horizontal: false,
    touched: false,
    noTrim: false,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

type TextInput = HTMLInputElement | HTMLTextAreaElement;

const stateTouched = ref(false);
const isTouched = computed(() => props.touched || stateTouched.value);
const isRequired = computed(() => props.required && isTouched.value && !props.modelValue);

// For number inputs, coerce the raw string the browser hands us into a
// real number with `min`/`max`/`step` enforced — Firefox doesn't do
// step rounding on its own, and Safari may surface locale decimal
// separators. Without this Field, callers had to reimplement
// per-browser parsing on every field.
const attrs = useAttrs();
const numberConstraints = () => ({
  min: attrs.min !== undefined ? Number(attrs.min) : undefined,
  max: attrs.max !== undefined ? Number(attrs.max) : undefined,
  step: attrs.step !== undefined ? Number(attrs.step) : undefined,
});

// Emit a string so existing string-consuming callers (e.g. TextTool's
// `changeFontSize` which calls `.replace()` on the value) still work
// unchanged. The value is a coerced, clamped, step-rounded number that
// happens to be stringified — consumers parsing it with Number() get
// the same number on every browser.
const emitNumber = (raw: string) => {
  const n = coerceNumber(raw, numberConstraints());
  emit("update:modelValue", n === null ? "" : String(n));
};

const handleInput = (e: Event) => {
  const value = (e.target as TextInput).value;
  if (props.type === "number") {
    emitNumber(value);
    return;
  }
  emit("update:modelValue", value);
};

const handleBlur = (e: Event) => {
  const value = (e.target as TextInput).value;
  stateTouched.value = true;
  if (props.type === "number") {
    emitNumber(value);
    return;
  }
  if (!props.noTrim) {
    emit("update:modelValue", value.trim());
  }
};

// Hint mobile keyboards: number inputs get the numeric/decimal pad.
// Browsers without `inputmode` support ignore it, so this is a pure
// progressive enhancement.
const inputMode = computed(() => {
  if (props.type !== "number") return undefined;
  const step = attrs.step !== undefined ? Number(attrs.step) : undefined;
  return step !== undefined && step < 1 ? "decimal" : "numeric";
});
</script>

<template>
  <div class="field" :class="{ 'is-horizontal': horizontal }">
    <div :class="{ 'field-label': horizontal }">
      <label v-if="label" class="label">{{ label }}</label>
    </div>

    <div class="field-body">
      <div class="field">
        <slot>
          <div
            class="control is-expanded"
            :class="{
              'has-icons-left': left,
              'has-icons-right': right,
            }"
          >
            <textarea
              v-if="type === 'textarea'"
              class="textarea"
              :class="{ 'is-danger': isTouched && (isRequired || error) }"
              :placeholder="placeholder"
              :value="modelValue"
              v-bind="$attrs"
              @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
              @blur="handleBlur"
            ></textarea>
            <input
              v-else
              class="input"
              :class="{ 'is-danger': isTouched && (isRequired || error) }"
              :type="type"
              :placeholder="placeholder"
              :value="modelValue"
              :inputmode="inputMode"
              v-bind="$attrs"
              @input="handleInput"
              @blur="handleBlur"
            />
            <slot name="left">
              <span v-if="left" class="icon is-small is-left">
                <i :class="left"></i>
              </span>
            </slot>
            <slot name="right">
              <span v-if="right" class="icon is-small is-right">
                <i :class="right"></i>
              </span>
            </slot>
          </div>
          <p v-if="isTouched && error" class="help is-danger">
            <span>{{ error }}</span>
          </p>
          <p v-if="isRequired" class="help is-danger">
            <span v-if="requiredMessage">{{ requiredMessage }}</span>
            <span v-else>{{ label }} is required</span>
          </p>
          <template v-else>
            <p v-if="help" class="help">{{ help }}</p>
          </template>
        </slot>
      </div>
    </div>
  </div>
</template>

<style></style>
