<script>
// Aliased to AppObject because "Object" is a reserved HTML element name
// (vue/no-reserved-component-names).
import AppObject from "../Object.vue";
import MenuContent from "./ContextMenuAvatar.vue";
import StreamContextMenu from "../ContextMenuStream.vue";

export default {
  components: { AppObject, MenuContent, StreamContextMenu },
  props: { object: Object },
};
</script>

<template>
  <AppObject :object="object">
    <template #menu="slotProps">
      <!-- Live RTMP feeds share the standardised stream menu with jitsi
           tiles (Jitsi.vue) instead of the avatar/prop/video menu. -->
      <StreamContextMenu v-if="object.isRTMP" v-bind="slotProps" :object="object" />
      <MenuContent v-else v-bind="slotProps" v-model:active="active" :object="object" />
    </template>
  </AppObject>
</template>

<style></style>
