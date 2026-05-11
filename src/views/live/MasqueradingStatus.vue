<script setup lang="ts">
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import Icon from "components/Icon.vue";

const stageStore = useStageStore();
const masquerading = computed<boolean>(() => stageStore.masquerading);
const exitAudienceView = () => {
  stageStore.TOGGLE_MASQUERADING();
};
</script>

<template>
  <a-tooltip
    v-if="masquerading"
    title="You are masquerading as audience. Click to go back to the player mode!"
  >
    <div id="masquerading-status" class="clickable has-tooltip-left" @click="exitAudienceView">
      <Icon src="incognito.svg" :size="36" />
    </div>
  </a-tooltip>
</template>

<style scoped lang="scss">
#masquerading-status {
  position: absolute;
  z-index: 10;
  top: 76px;
  right: 16px;
}
</style>
