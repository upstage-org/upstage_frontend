<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { useRoute } from "vue-router";
import { useTitle } from "@vueuse/core";
import { useStageViewport } from "@composables/useStageViewport";
import { useUserStore } from "@stores/pinia/user";
import { useConfigStore } from "@stores/pinia/config";
import "styles/bulma.css";
import "styles/bulma_slider.css";
import "styles/custom.less";

useUserStore().fetchCurrent();
useConfigStore().fetchConfig();
const route = useRoute();
useStageViewport();

const title = useTitle();
watch(
  () => route.name,
  (name) => {
    title.value = name ? `UpStage - ${String(name)}` : "UpStage";
  },
  { immediate: true },
);

// Version state
interface VersionData {
  version: string;
}
const currentVersion = ref<string | null>(null);
const latestVersion = ref<string | null>(null);
const showReloadPrompt = ref<boolean>(false);

const hasShowPrompt = computed(() => {
  const isExcludedRoute = ["Live"].includes(route.name as string);
  return showReloadPrompt.value && !isExcludedRoute;
});

// Check version
const checkVersion = async (): Promise<void> => {
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    const data: VersionData = await response.json();
    latestVersion.value = data.version;

    if (!localStorage.getItem("appVersion")) {
      localStorage.setItem("appVersion", latestVersion.value);
    }

    currentVersion.value = localStorage.getItem("appVersion") || latestVersion.value;
    showReloadPrompt.value = false;

    if (latestVersion.value && latestVersion.value !== currentVersion.value) {
      showReloadPrompt.value = true;
    }
  } catch (error) {
    console.error("Failed to check version:", error);
  }
};

const reloadPage = () => {
  if (latestVersion.value) {
    localStorage.setItem("appVersion", latestVersion.value);
    window.location.reload();
  }
};

onMounted(() => {
  caches
    .keys()
    .then((keyList) => Promise.all(keyList.map((key) => caches.delete(key))))
    .catch((err) => console.error("Cache clear failed:", err));

  // Version checking is self-contained: poll /version.json on mount and every
  // 3 minutes, and surface the reload prompt when it differs from the stored
  // version. This no longer involves the (now removed) Service Worker.
  checkVersion();
  setInterval(
    () => {
      void checkVersion();
    },
    3 * 60 * 1000,
  );
});
</script>

<template>
  <a-config-provider
    :theme="{
      token: {
        colorPrimary: '#007011',
        borderRadius: 4,
        fontSize: 16,
        fontFamily: 'Josefin Sans, sans-serif',
        colorPrimaryBg: '#ffffff',
      },
      components: {},
    }"
  >
    <router-view />
    <div v-if="hasShowPrompt" class="reload-prompt">
      <p>A new version ({{ latestVersion }}) is available!</p>
      <button @click="reloadPage">Reload Now</button>
    </div>
  </a-config-provider>
</template>

<style lang="scss">
html {
  overflow-y: auto !important;
}

html,
body {
  /* Kill Android Chrome pull-to-refresh: a failed touch-drag from the toolbox
   * used to reload the whole stage. -y only, so horizontal swipe-back
   * navigation on admin/management pages keeps working. */
  overscroll-behavior-y: none;
}

body.waiting * {
  cursor: wait !important;
}

.is-fullwidth {
  width: 100%;
}

@media screen and (max-width: 768px) {
  .is-fullwidth-mobile {
    width: 100%;
  }
}

.is-fullheight {
  height: 100%;
}

.clickable {
  pointer-events: all !important;
  cursor: pointer;
}

[contenteditable] {
  -webkit-user-select: text !important;
  user-select: text !important;

  * {
    font-family: inherit;
  }
}

/* Required by the mobile-drag-drop polyfill (initialised in main.ts) so
 * iOS Safari recognises [draggable=true] elements. Without these two
 * declarations, Safari either ignores the touch entirely or treats it as
 * a text selection / image hold instead of a drag. Desktop browsers are
 * unaffected. */
[draggable="true"] {
  -webkit-user-drag: element;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}

/* moveable@0.53 sets no touch-action itself, so without this, dragging a
 * resize/rotate handle on a touch screen pans the page instead of resizing
 * the object. The control box is rendered on document.body (outside any
 * scoped style), hence it lives here. */
.moveable-control-box {
  touch-action: none;
}

@media (pointer: coarse) {
  /* moveable's injected default is 14x14 / margin -7px — too small for
   * fingers. The doubled selector out-specifies its runtime-injected sheet
   * without !important. Keep margin = -size/2 so handles stay centred on
   * the frame corners. */
  .moveable-control-box .moveable-control {
    width: 24px;
    height: 24px;
    margin-top: -12px;
    margin-left: -12px;
  }
}

.root {
  padding: 0px !important;
}

.reload-prompt {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: #fff;
  padding: 10px;
  border: 1px solid #ccc;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
  z-index: 9999;
}
</style>
