<script setup lang="ts">
/**
 * Right-click menu of an embedded meeting (#1566). A meeting had no menu at
 * all; this gives it the one entry players asked for: pick a prop from the
 * Props panel to wear over the meeting, e.g. to cover the Jitsi toolbar for
 * the audience. The prop then follows the meeting like a frame on a stream
 * tile, and any player can adjust it or take it off ("Remove from meeting").
 */
import { useStageStore } from "@stores/pinia/stage";
import Icon from "components/Icon.vue";

const props = defineProps<{
  object: { id: string | number };
  closeMenu: () => void;
}>();

const stageStore = useStageStore();

const addProp = () => {
  stageStore.startAttachingProp(props.object.id);
  props.closeMenu();
};
</script>

<template>
  <div class="card-content p-0">
    <a class="panel-block" data-testid="meeting-add-prop" @click="addProp">
      <span class="panel-icon">
        <Icon src="prop.svg" />
      </span>
      <span>{{ $t("add_prop_to_meeting") }}</span>
    </a>
  </div>
</template>
