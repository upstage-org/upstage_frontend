<script>
/*
 * Standalone chat-only view at `/chat/:url`.
 *
 * Two consumer scenarios this view supports:
 *   1. Mobile audience members opening the URL directly on a phone
 *      while watching a projection of the stage in a shared room.
 *      They get a full-screen chat input with no stage chrome.
 *   2. Desktop performers / meta-theater operators who clicked the
 *      "pop out" button on the on-stage chat panel; window.open()
 *      lands them here so they can drag the chat to a second
 *      monitor via the OS window manager.
 *
 * Implementation strategy: do the same loadStage + connect dance as
 * views/live/Layout.vue (so the MQTT subscription on TOPICS.CHAT is
 * established), then mount the existing Chat/index.vue + PlayerChat
 * components verbatim. They adapt their layout based on the
 * provide('isChatStandalone', true) injection token below. The same
 * MQTT topic carries messages between the main stage view and any
 * popped-out / mobile windows, so chat is bidirectional with zero
 * additional plumbing.
 *
 * Avatar text-to-speech (meSpeak) is suppressed while this layout is
 * mounted: standalone chat participants should not hear voices on every
 * phone in a hybrid room when the projected stage already carries audio.
 */
import { computed, onMounted, onUnmounted, provide, ref, watch } from "vue";
import { stopSpeaking } from "@services/speech";
import { storeToRefs } from "pinia";
import { useRoute } from "vue-router";
import { useAuthStore } from "@stores/pinia/auth";
import { useStageStore } from "@stores/pinia/stage";
import { usePageWakeRecovery } from "@composables/usePageWakeRecovery";
import Chat from "components/stage/Chat/index.vue";
import PlayerChat from "components/stage/Chat/PlayerChat.vue";
import LoginPrompt from "../live/LoginPrompt.vue";
import HiddenStageAssetPreloader from "./HiddenStageAssetPreloader.vue";

export default {
  components: { Chat, PlayerChat, LoginPrompt, HiddenStageAssetPreloader },
  setup: () => {
    const stageStore = useStageStore();
    const { loggedIn } = storeToRefs(useAuthStore());
    const { ready, canPlay } = storeToRefs(stageStore);
    const route = useRoute();

    // Two consumers of this flag inside the chat components:
    //   * suppresses the new "Pop out" button (no point popping out
    //     from a window that IS the pop-out),
    //   * tells PlayerChat to skip its Moveable.js draggable wrapper
    //     and the in-stage floating-card positioning, so the chat
    //     lays out inline inside this view.
    provide("isChatStandalone", true);

    onMounted(() => {
      stageStore.setSuppressAvatarSpeechOutput(true);
      stopSpeaking();
    });

    stageStore.loadStage({ url: route.params.url }).then(() => {
      stageStore.connect();
    });

    onUnmounted(() => {
      stageStore.setSuppressAvatarSpeechOutput(false);
      stageStore.disconnect();
    });

    // Same pagehide/beforeunload guard as views/live/Layout.vue so
    // the broker counter-leave fires before Firefox tears the
    // standalone tab down and leaves a zombie viewer in everyone
    // else's session list.
    const onUnload = () => {
      stageStore.disconnectSync();
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) {
        onUnload();
      }
    });

    // Pop-out/mobile chat must mirror the live stage UX: Player Chat is only
    // for authenticated performers. `canPlay` alone follows GraphQL permission
    // and can disagree with absent auth (guests opening `/chat/:url`).
    const showPlayerChatStandalone = computed(() => loggedIn.value && canPlay.value);

    usePageWakeRecovery(() => {
      if (stageStore.status === "OFFLINE") {
        stageStore.connect();
      }
    });

    // Which pane is active when both are available (`showPlayerChatStandalone`). The
    // standalone view stacks the two chats behind a small tab bar
    // instead of rendering both at once, so the mobile viewport
    // isn't split between two half-height panes.
    const activeTab = ref("public");

    watch(showPlayerChatStandalone, (ok) => {
      if (!ok && activeTab.value === "player") {
        activeTab.value = "public";
      }
    });

    return { ready, canPlay: showPlayerChatStandalone, activeTab };
  },
};
</script>

<template>
  <div class="chat-standalone">
    <!-- Keeps Pinia `preloading` in sync with main Live Preloader.vue (stage `ready`). -->
    <HiddenStageAssetPreloader />
    <div v-if="ready" class="chat-standalone__inner">
      <!--
        LoginPrompt mirrors the main-stage flow: an unauthenticated
        visitor gets the choice of logging in, entering a nickname,
        or just clicking through to enter as "Guest". Same modal
        component reused so we don't fork the audience-onboarding
        UX between the main stage and the standalone chat.
      -->
      <LoginPrompt />

      <!--
        Tab bar only when the visitor is authenticated and has on-stage
        player permissions (see `showPlayerChatStandalone` in script).
        Guests and audience see only public chat and the login / nickname
        onboarding from LoginPrompt.
      -->
      <nav v-if="canPlay" class="chat-standalone__tabs">
        <button
          type="button"
          class="chat-standalone__tab"
          :class="{ 'chat-standalone__tab--active': activeTab === 'public' }"
          @click="activeTab = 'public'"
        >
          {{ $t("public_chat") || "Public" }}
        </button>
        <button
          type="button"
          class="chat-standalone__tab"
          :class="{ 'chat-standalone__tab--active': activeTab === 'player' }"
          @click="activeTab = 'player'"
        >
          {{ $t("player_chat") || "Player" }}
        </button>
      </nav>

      <div class="chat-standalone__pane">
        <!--
          v-show (not v-if) keeps the inactive pane mounted so its
          MQTT subscription state and unread-counters survive a tab
          switch. When the Player tab is unavailable (!canPlay in this
          template) the tab bar is hidden and only the public pane is shown.
        -->
        <Chat v-show="!canPlay || activeTab === 'public'" />
        <PlayerChat v-if="canPlay" v-show="activeTab === 'player'" />
      </div>
    </div>
    <div v-else class="chat-standalone__loading">
      {{ $t("loading") || "Loading..." }}
    </div>
  </div>
</template>

<style lang="scss" scoped>
/*
 * Mobile-first layout: full viewport, no fixed-width sidebar. The
 * existing Chat/index.vue and PlayerChat.vue components use
 * `position: fixed` for their on-stage floating cards; in standalone
 * mode their `:deep` selectors below pin them to the viewport instead
 * (effectively the same visual result, but without the on-stage
 * Moveable.js handling).
 */
.chat-standalone {
  height: 100vh;
  /* Modern viewport unit that excludes the iOS Safari URL bar so the
     chat input isn't pushed off-screen when the bar collapses. Falls
     back to the standard vh on engines that don't grok dvh. */
  height: 100dvh;
  width: 100%;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  background-color: #f5f5f5;
}

.chat-standalone__inner {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.chat-standalone__tabs {
  display: flex;
  gap: 4px;
  padding: 8px 8px 0 8px;
  background-color: #fff;
  border-bottom: 1px solid #e0e0e0;
}

.chat-standalone__tab {
  flex: 1 1 0;
  background: transparent;
  border: 1px solid #e0e0e0;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  padding: 12px 16px;
  font-size: 16px;
  cursor: pointer;
  color: #444;
}

.chat-standalone__tab--active {
  background-color: #f5f5f5;
  color: #000;
  font-weight: 600;
}

.chat-standalone__pane {
  flex: 1 1 auto;
  position: relative;
  min-height: 0;
}

.chat-standalone__loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: #777;
}

/*
 * Override the on-stage floating-card positioning of the two chat
 * components when they're mounted inside this standalone view. They
 * normally pin themselves at fixed corners of the stage viewport;
 * here we want them filling the .chat-standalone__pane fully.
 *
 * Uses :deep() so the rules pierce the scoped boundary of the child
 * components without us having to fork their templates.
 */
:deep(#chatbox),
:deep(#player-chatbox) {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  min-width: 0 !important;
  max-width: none !important;
  bottom: auto !important;
  right: auto !important;
  left: auto !important;
  top: auto !important;
  z-index: 1 !important;
}

/*
 * Do not set global min-width/min-height on `.button` here: the chat
 * components size their controls; a blanket rule inflated the emoji
 * send/reaction controls in the pop-out (especially with portrait layout).
 *
 * Sticky chat input: child components render their input inside
 * <footer class="card-footer">, so we pin that footer to the bottom of the
 * standalone pane. position: sticky inside an
 * `overflow-y: auto` scroll container keeps the input in view when
 * iOS Safari's URL bar collapses; the fallback `position: sticky;
 * bottom: 0` is also picked up by Chrome / Firefox on Android.
 */
:deep(.card-footer) {
  position: sticky;
  bottom: 0;
  background-color: inherit;
  z-index: 2;
}

/*
 * Slightly larger, well-padded chat input on touch screens — the
 * default 22px line-height is hard to tap on a phone.
 */
:deep(.card-footer .textarea),
:deep(.card-footer input) {
  min-height: 40px;
  font-size: 16px; /* >=16px prevents iOS Safari auto-zoom on focus */
}

/* Suppress horizontal scroll on small screens. */
.chat-standalone {
  overflow-x: hidden;
}
</style>
