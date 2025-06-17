<template>
  <Logo id="live-logo" />
  <div id="main-content">
    <Preloader />
    <template v-if="ready">
      <Board />
      <Controls />
      <ConnectionStatus />
      <Chat />
      <AudioPlayer />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, provide, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useStageStore } from "store/modules/stage";
import Logo from "components/Logo.vue";
import Chat from "components/stage/Chat/index.vue";
import Board from "components/stage/Board.vue";
import AudioPlayer from "components/stage/AudioPlayer.vue";
import Preloader from "views/live/Preloader.vue";
import ConnectionStatus from "views/live/ConnectionStatus.vue";
import Controls from "./Controls.vue";

const route = useRoute();
const stageStore = useStageStore();

// Computed properties
const ready = computed(() => stageStore.model && !stageStore.preloading);

// Provide replay context to child components
provide("replaying", true);

// Load stage data when component is mounted
onMounted(() => {
  stageStore.loadStage({
    url: route.params.url as string,
    recordId: route.params.id as string,
  });
});
</script>

<style lang="scss">
#main-content {
  min-height: calc(100vh - 120px);
}

#live-stage {
  *:not(input, textarea) {
    -webkit-user-select: none;
    /* Safari */
    user-select: none;
    /* Non-prefixed version, currently supported by Chrome, Edge, Opera and Firefox */
  }
}

#live-logo {
  position: fixed;
  right: 0px;
  z-index: 1;
  max-width: 200px;

  @media screen and (min-width: 1024px) {
    img {
      max-height: unset;
    }
  }
}
</style>
