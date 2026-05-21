<script>
// Aliased: "Object" is a reserved HTML element name (vue/no-reserved-component-names).
import AppObject from "./Object.vue";
import MenuContent from "./Avatar/ContextMenuAvatar.vue";
import { useDrawing } from "components/stage/Toolboxs/tools/Draw/composable";
import { computed } from "vue";

export default {
  components: { AppObject, MenuContent },
  props: { object: Object },
  setup: (props) => {
    const drawing = computed(() => ({ ...props.object }));
    const { el } = useDrawing(drawing);

    return { el };
  },
};
</script>

<template>
  <AppObject :object="object">
    <template #menu="slotProps">
      <MenuContent v-model:active="active" :object="object" :close-menu="slotProps.closeMenu" />
    </template>
    <template #render>
      <canvas ref="el"></canvas>
    </template>
  </AppObject>
</template>

<style></style>
