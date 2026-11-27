<script setup lang="ts">
import Icon from "components/Icon.vue";
import { inject } from "vue";
import type { Ref } from "vue";

defineProps<{
  name?: string;
  label?: string;
  icon?: string;
}>();
defineEmits<{
  (e: "click"): void;
}>();

// Provided by Toolboxs/index.vue. `tool` is a ref: the template unwraps it.
const tool = inject("tool") as Ref<string | undefined> | undefined;
const changeTool = inject("changeTool") as (name?: string) => void;
</script>

<template>
  <a-tooltip placement="rightBottom">
    <template #title>{{ label ?? name }}</template>
    <a
      :class="{ 'is-active': tool === name }"
      class="panel-block button"
      @click="
        changeTool(name);
        $emit('click');
      "
    >
      <span class="panel-icon">
        <Icon :src="icon as string" />
      </span>
    </a>
  </a-tooltip>
</template>

<style lang="scss" scoped></style>
