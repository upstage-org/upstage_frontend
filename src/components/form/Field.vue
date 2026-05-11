<script>
import { computed, ref } from "vue";
export default {
  props: {
    required: {
      type: Boolean,
      default: false,
    },
    requiredMessage: {
      type: String,
    },
    modelValue: {
      type: String,
    },
    label: {
      type: String,
    },
    type: {
      type: String,
      default: "text",
    },
    placeholder: {
      type: String,
    },
    left: {
      type: String,
    },
    right: {
      type: String,
    },
    horizontal: {
      type: Boolean,
      default: false,
    },
    help: {
      type: String,
    },
    error: {
      type: String,
    },
    touched: {
      type: Boolean,
      default: false,
    },
    noTrim: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue"],
  setup: (props, { emit }) => {
    const stateTouched = ref(false);
    const isTouched = computed(() => props.touched || stateTouched.value);
    const isRequired = computed(() => props.required && isTouched.value && !props.modelValue);

    const handleBlur = (e) => {
      stateTouched.value = true;
      if (!props.noTrim) {
        emit("update:modelValue", e.target.value.trim());
      }
    };

    return { isRequired, stateTouched, isTouched, handleBlur };
  },
};
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
              @input="$emit('update:modelValue', $event.target.value)"
              @blur="handleBlur"
            ></textarea>
            <input
              v-else
              class="input"
              :class="{ 'is-danger': isTouched && (isRequired || error) }"
              :type="type"
              :placeholder="placeholder"
              :value="modelValue"
              v-bind="$attrs"
              @input="$emit('update:modelValue', $event.target.value)"
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
