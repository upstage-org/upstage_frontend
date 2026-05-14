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
    stageStore.loadStage({ url: route.params.url }).then(() => {
      stageStore.connect();
    });

    onUnmounted(() => {
      stageStore.disconnect();
    });

    // `beforeunload` is the historical hook but Firefox in particular often
    // tears the page down before the awaited disconnect publishes its
    // counter-leave, leaving zombie viewers in everyone else's session list
    // and inflating the LIVE counts. Use disconnectSync (fire-and-forget
    // MQTT publish) and also listen on `pagehide`, which fires even when
    // bfcache or background-tab eviction kicks in. The !event.persisted
    // guard avoids false-leaves when the page is going into bfcache and
    // may be restored without a reload.
    const onUnload = () => {
      stageStore.disconnectSync();
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) {
        onUnload();
      }
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
  top: max(8px, env(safe-area-inset-top, 0px));
  right: 0px;
  max-width: 200px;
  z-index: 1;

  // The Logo component renders inside a Bulma .navbar-item, which is
  // transparent at rest and only gains a light hover-background. On a
  // dark backdrop/curtain the dark UpStage mark is invisible until the
  // mouse hovers it. Force the hover-style background to be the default
  // here so the mark is always legible regardless of the stage colour.
  .navbar-item {
    background-color: rgba(255, 255, 255, 0.92);
    border-bottom-left-radius: 8px;
    padding: 4px 8px;
  }

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
