<template>
  <a-config-provider :theme="{
    token: {
      colorPrimary: '#007011',
      borderRadius: 4,
      fontSize: 16,
      fontFamily: 'Josefin Sans, sans-serif',
      colorPrimaryBg: '#ffffff',
    },
    components: {},
  }">
    <router-view />
    <div v-if="hasShowPrompt" class="reload-prompt">
      <p>A new version ({{ latestVersion }}) is available!</p>
      <button @click="reloadPage">Reload Now</button>
    </div>
  </a-config-provider>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute } from "vue-router";
import { useUserStore } from "store/modules/user";
import { useConfigStore } from "store/modules/config";
import "styles/bulma.css";
import "styles/bulma_slider.css";
import "styles/custom.less";

// Store initialization
const userStore = useUserStore();
const configStore = useConfigStore();
userStore.fetchCurrent();
configStore.fetchConfig();
const route = useRoute();

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

const notifyServiceWorker = () => {
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "CHECK_UPDATE" });
  }
};

onMounted(() => {
  caches.keys()
    .then((keyList) => Promise.all(keyList.map((key) => caches.delete(key))))
    .catch((err) => console.error("Cache clear failed:", err));

  checkVersion();
  setInterval(() => {
    checkVersion();
    notifyServiceWorker();
  }, 3 * 60 * 1000);

  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "VERSION_UPDATE") {
      latestVersion.value = event.data.version;
      if (latestVersion.value !== currentVersion.value) {
        showReloadPrompt.value = true;
      }
    }
  });

  window.addEventListener("newVersionAvailable", () => {
    checkVersion();
  });
});
</script>

<style lang="scss">
html {
  overflow-y: auto !important;
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