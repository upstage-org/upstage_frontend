<script>
import Icon from "components/Icon.vue";
export default {
  components: { Icon },
  inject: ["tool", "changeTool"],
  props: {
    name: String,
    label: String,
    icon: String,
  },
  emits: ["click"],
};
</script>

<template>
  <a-tooltip placement="rightBottom">
    <template #title>{{ label ?? name }}</template>
    <a
      :class="{ 'is-active': tool?.value === name }"
      class="panel-block button"
      @click="
        changeTool(name);
        $emit('click');
      "
    >
      <span class="panel-icon">
        <Icon :src="icon" />
      </span>
    </a>
  </a-tooltip>
</template>

<style lang="scss" scoped></style>
