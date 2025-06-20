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

<script>
import configs from "config";
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
import { useRoute } from "vue-router";
import { computed, onMounted, onUnmounted } from "vue";
import { useStageStore } from "store/modules/stage";
import { storeToRefs } from "pinia";
import { useUserStore } from "store/modules/user";

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
    Shell
  },
  setup: () => {
    const route = useRoute();
    const stageStore = useStageStore();
    const userStore = useUserStore();
    const { ready, canPlay } = storeToRefs(stageStore);

    onMounted(async () => {
      await stageStore.loadStage({ url: route.params.url });
      stageStore.connect();
    });

    onUnmounted(() => {
      stageStore.disconnect();
    });

    const loggedIn = computed(() => userStore.whoami !== null);
    const studioEndpoint = "/stages/";

    return {
      ready,
      canPlay,
      loggedIn,
      studioEndpoint,
    };
  },
};
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
