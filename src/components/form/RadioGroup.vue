<script>
import HorizontalField from "./HorizontalField";
// Aliased: "Switch" is a reserved HTML element name (vue/no-reserved-component-names).
import AppSwitch from "./Switch";

export default {
  components: { HorizontalField, AppSwitch },
  props: {
    data: Array,
    modelValue: String,
    renderLabel: {
      type: Function,
      default: (item) => item,
    },
    renderValue: {
      type: Function,
      default: (item) => item,
    },
    allowClear: {
      type: Boolean,
      default: false,
    },
    clearTooltip: String,
  },
  emits: ["update:modelValue"],
  setup: (props) => {
    console.log(props);
    return {};
  },
};
</script>

<template>
  <HorizontalField v-bind="$attrs">
    <AppSwitch
      v-for="item in data"
      :key="item"
      class="is-rounded is-success mr-2"
      :model-value="renderValue(item) === modelValue"
      :label="renderLabel(item)"
      @update:model-value="$emit('update:modelValue', renderValue(item))"
    />
    <a-tooltip :title="clearTooltip">
      <button
        v-if="allowClear && modelValue"
        class="button is-danger ml-2 is-small"
        @click="$emit('update:modelValue', null)"
      >
        <span class="icon">
          <i class="fas fa-times"></i>
        </span>
        <span>{{ $t("clear") }}</span>
      </button>
    </a-tooltip>
  </HorizontalField>
</template>

<style></style>
