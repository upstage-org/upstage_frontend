<script>
// Aliased to AppObject because "Object" is a reserved HTML element name
// (vue/no-reserved-component-names).
import AppObject from "../Object.vue";
import MenuContent from "./ContextMenuAvatar.vue";

export default {
  components: { AppObject, MenuContent },
  props: { object: Object },
};
</script>

<template>
  <AppObject :object="object">
    <template #menu="slotProps">
      <MenuContent v-bind="slotProps" v-model:active="active" :object="object" />
    </template>
  </AppObject>
</template>

<style></style>
