<script>
import Logo from "components/Logo.vue";
import SettingPopup from "components/stage/SettingPopup/index.vue";
import Chat from "components/stage/Chat/index.vue";
import PlayerChat from "components/stage/Chat/PlayerChat.vue";
import StageToolbox from "components/stage/Toolboxs/index.vue";
import Board from "components/stage/Board.vue";
import AudioPlayer from "components/stage/AudioPlayer.vue";
import Shell from "components/objects/MeetingObject/Shell.vue";
import Preloader from "./Preloader.vue";
import LoginPrompt from "./LoginPrompt.vue";
import ConnectionStatus from "./ConnectionStatus.vue";
import MasqueradingStatus from "./MasqueradingStatus.vue";
import { useStageStore } from "@stores/pinia/stage";
import { computed, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { loggedIn } from "utils/auth";

export default {
  components: {
    Logo,
    Preloader,
    LoginPrompt,
    SettingPopup,
    Chat,
    PlayerChat,
    StageToolbox,
    Board,
    AudioPlayer,
    ConnectionStatus,
    MasqueradingStatus,
    Shell,
  },
  setup: () => {
    const stageStore = useStageStore();
    const ready = computed(() => stageStore.ready);

    const route = useRoute();
    // `loadStage` is an async Pinia action (it awaits a GraphQL
    // request), so the .then(...) chain remains valid after the move
    // off Vuex's dispatch wrapper.
    stageStore.loadStage({ url: route.params.url }).then(() => {
      stageStore.connect();
    });

    onUnmounted(() => {
      stageStore.disconnect();
    });

    window.addEventListener("beforeunload", () => {
      stageStore.disconnect();
    });

    const canPlay = computed(() => stageStore.canPlay);

    return {
      ready,
      canPlay,
      loggedIn,
      studioEndpoint: "/stages/",
    };
  },
};
</script>

<template>
  <div id="live-logo">
    <Logo v-if="loggedIn" :link="studioEndpoint" />
    <Logo v-else to="/" />
  </div>
  <Shell id="main-content">
    <Preloader />
    <template v-if="ready">
      <Board />
      <ConnectionStatus />
      <MasqueradingStatus />
      <StageToolbox v-if="canPlay" />
      <Chat />
      <PlayerChat v-if="canPlay" />
      <AudioPlayer />
      <LoginPrompt />
      <SettingPopup />
    </template>
  </Shell>
</template>

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
  max-width: 200px;
  z-index: 1;

  &.preloader {
    z-index: 20001;
  }

  @media screen and (min-width: 1024px) {
    img {
      max-height: unset;
    }
  }
}
</style>
