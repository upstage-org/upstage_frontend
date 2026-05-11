<script setup lang="ts">
import { computed, provide } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { useRoute } from "vue-router";
import Logo from "components/Logo.vue";
import Chat from "components/stage/Chat/index.vue";
import Board from "components/stage/Board.vue";
import AudioPlayer from "components/stage/AudioPlayer.vue";
import Preloader from "views/live/Preloader.vue";
import ConnectionStatus from "views/live/ConnectionStatus.vue";
import Controls from "./Controls.vue";

const stageStore = useStageStore();
const ready = computed<boolean>(() => !!stageStore.model && !stageStore.preloading);

const route = useRoute();
stageStore.loadStage({
  url: route.params.url,
  recordId: route.params.id,
});

provide("replaying", true);
</script>

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

<style lang="scss">
#main-content {
  min-height: calc(100vh - 120px);
}
#live-stage {
  *:not(input, textarea) {
    -webkit-user-select: none;
    user-select: none;
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
