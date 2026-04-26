<template>
  <a-tooltip v-if="masquerading" title="You are masquerading as audience. Click to go back to the player mode!">
    <div id="masquerading-status" class="clickable has-tooltip-left" @click="exitAudienceView">
      <Icon src="incognito.svg" :size="36" />
    </div>
  </a-tooltip>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import Icon from "components/Icon.vue";

const store = useStore();
const masquerading = computed<boolean>(() => store.state.stage.masquerading);
const exitAudienceView = () => {
  store.commit("stage/TOGGLE_MASQUERADING");
};
</script>

<style scoped lang="scss">
#masquerading-status {
  position: absolute;
  z-index: 10;
  top: 76px;
  right: 16px;
}
</style>
