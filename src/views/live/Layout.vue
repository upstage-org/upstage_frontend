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
import { useAuthStore } from "@stores/pinia/auth";
import { usePageWakeRecovery } from "@composables/usePageWakeRecovery";
import { storeToRefs } from "pinia";
import { computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { isJwtExpired, loggedIn } from "utils/auth";

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
    const authStore = useAuthStore();
    const { ready, canPlay } = storeToRefs(stageStore);

    const route = useRoute();
    stageStore.loadStage({ url: route.params.url }).then(() => {
      stageStore.connect();
    });

    onUnmounted(() => {
      stageStore.disconnect();
    });

    // Live-route expiry guard. The Live route does NOT set requireAuth
    // (audience members must be able to land here unauthenticated), so
    // a player whose JWT has gone stale can sit on the stage indefinitely
    // until something happens to fire a GraphQL call. MQTT chat / board
    // messages keep flowing because MQTT auth is build-time creds, not
    // the user's JWT — exactly the silent-zombie state the proactive
    // refresh in the auth store is designed to prevent. Re-check on
    // mount and on visibilitychange so a tab brought back from the
    // background after an overnight expiry detects it without waiting
    // for the next GraphQL operation.
    const checkExpiry = () => {
      if (authStore.loggedIn && isJwtExpired(authStore.getToken)) {
        authStore.logout();
      }
    };
    onMounted(checkExpiry);
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkExpiry();
    };
    document.addEventListener("visibilitychange", onVisibility);
    onUnmounted(() => {
      document.removeEventListener("visibilitychange", onVisibility);
    });

    usePageWakeRecovery(() => {
      checkExpiry();
      if (canPlay.value && stageStore.status === "OFFLINE") {
        stageStore.connect();
      } else if (canPlay.value) {
        stageStore.triggerReloadStreams();
      }
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
  <div id="live-top-bar">
    <div v-if="ready" class="live-top-bar-controls">
      <ConnectionStatus in-top-bar />
      <MasqueradingStatus />
    </div>
    <div id="live-logo">
      <Logo v-if="loggedIn" :link="studioEndpoint" />
      <Logo v-else to="/" />
    </div>
  </div>
  <Shell id="main-content">
    <Preloader />
    <template v-if="ready">
      <Board />
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

#live-top-bar {
  position: fixed;
  top: max(8px, env(safe-area-inset-top, 0px));
  right: 0;
  z-index: 5;
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  max-width: calc(100vw - 8px);
  pointer-events: none;

  &.preloader {
    z-index: 20001;
  }

  .live-top-bar-controls,
  #live-logo {
    pointer-events: auto;
  }

  .live-top-bar-controls {
    display: flex;
    flex-flow: row nowrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
    flex: 0 1 auto;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }
}

#live-logo {
  flex: 0 0 auto;
  max-width: 140px;

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

  img {
    max-height: 36px;
    width: auto;
    height: auto;
  }
}
</style>
