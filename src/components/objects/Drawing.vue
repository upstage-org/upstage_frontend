<template>
  <Object :object="object">
    <template #menu="slotProps">
      <MenuContent :object="object" :closeMenu="slotProps.closeMenu" v-model:active="active" />
    </template>
    <template #render>
      <canvas ref="el"></canvas>
    </template>
  </Object>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import Object from "./Object.vue";
import MenuContent from "./Avatar/ContextMenuAvatar.vue";
import { useDrawing } from "components/stage/Toolboxs/tools/Draw/composable";
import { useUserStore } from "store/modules/user";
import { ObjectProps } from "interfaces";

interface Props {
  object: ObjectProps;
}

const props = defineProps<Props>();
const active = ref(false);

// Use Pinia stores
const userStore = useUserStore();

const drawing = computed(() => ({ ...props.object }));
const { el } = useDrawing(drawing);
</script>

<style></style>
