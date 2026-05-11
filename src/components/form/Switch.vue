<script>
import { v4 as uuidv4 } from "uuid";
import Icon from "components/Icon.vue";
import Loading from "components/Loading.vue";

export default {
  components: { Icon, Loading },
  props: {
    className: String,
    modelValue: Boolean,
    label: String,
    checkedLabel: String,
    uncheckedLabel: String,
    loading: Boolean,
  },
  emits: ["update:modelValue"],
  setup: () => {
    const id = uuidv4();
    return { id };
  },
};
</script>

<template>
  <div class="field is-inline-block is-relative">
    <span v-if="!!checkedLabel && modelValue" class="on-switch-label" style="left: 10px">
      {{ checkedLabel }}
    </span>
    <span v-if="!!uncheckedLabel && !modelValue" class="on-switch-label" style="left: 25px">
      {{ uncheckedLabel }}
    </span>
    <input
      :id="id"
      type="checkbox"
      v-bind="$attrs"
      :checked="modelValue"
      style="display: none"
      @input="$emit('update:modelValue', $event.target.checked)"
    />
    <label class="clickable" :for="id">
      <Loading v-if="loading" height="24px" />
      <template v-else>
        <Icon v-if="modelValue" src="toggle_on.svg" size="36" height="24" />
        <Icon v-else src="toggle_off.svg" size="36" height="24" />
      </template>
      {{ label }}
    </label>
  </div>
</template>

<style scoped>
.on-switch-label {
  pointer-events: none;
  position: absolute;
  color: white;
  z-index: 1;
  top: 2px;
}
img {
  vertical-align: middle;
}
</style>
