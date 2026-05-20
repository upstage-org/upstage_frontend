<script setup lang="ts">
import { computed, onUnmounted, provide } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { message } from "ant-design-vue";
import { stopSpeaking } from "@services/speech";
import { copyReplayLink } from "@utils/replayLink";
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
// `route.params.*` is `string | string[]` — the dynamic segments
// `:url` and `:id` are scalars in our router, so coerce once here so
// the rest of the surface stays string-typed.
const url = Array.isArray(route.params.url) ? route.params.url[0] : route.params.url;
const id = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id;
stageStore.loadStage({
  url,
  recordId: id,
});

provide("replaying", true);

const { t } = useI18n();

const copyLink = async () => {
  if (!url || !id) return;
  try {
    await copyReplayLink(url, id);
    message.success(t("replay_link_copied"));
  } catch {
    message.error(t("replay_copy_failed"));
  }
};

onUnmounted(() => {
  stopSpeaking();
  stageStore.pauseReplay();
});
</script>

<template>
  <Logo id="live-logo" />
  <div v-if="ready" class="replay-header-actions">
    <button type="button" class="button is-small is-light" @click="copyLink">
      <i class="fas fa-link"></i>
      <span>{{ $t("replay_copy_link_header") }}</span>
    </button>
  </div>
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
.replay-header-actions {
  position: fixed;
  top: max(8px, env(safe-area-inset-top, 0px));
  right: 148px;
  z-index: 5;
}

#live-logo {
  position: fixed;
  right: 0px;
  z-index: 1;
  max-width: 200px;

  // Give the logo a solid plaque-style background so it stays legible
  // over dark backdrops/curtains. Without this the .navbar-item that
  // wraps the Logo image is transparent at rest and only becomes
  // visible on hover (Bulma's default).
  .navbar-item {
    background-color: rgba(255, 255, 255, 0.92);
    border-bottom-left-radius: 8px;
    padding: 4px 8px;
  }

  @media screen and (min-width: 1024px) {
    img {
      max-height: unset;
    }
  }
}
</style>
