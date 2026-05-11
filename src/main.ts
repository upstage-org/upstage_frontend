import $ from "jquery";
// `public/js/jitsi/lib-jitsi-meet.min.js` (see index.html) still references a global jQuery
window.jQuery = window.$ = $;

import { createApp } from "vue";
import App from "./App.vue";
import i18n from "./i18n";
import "./styles/studio.less";
import { router } from "router";
import store from "./store";
import { pinia } from "./store/pinia";
import "@fortawesome/fontawesome-free/css/all.css";
import ClickOutside from "./directives/ClickOutside";
import { installApolloClient } from "./apollo";

installApolloClient();
const app = createApp(App)
  .use(pinia)
  .use(store)
  .use(router)
  .use(i18n)
  .directive("click-outside", ClickOutside);

if (import.meta.env.DEV || import.meta.env.VITE_E2E) {
  // Vuex (now stage-only, and itself just a Pinia-backed facade after
  // Wave D). Still exposed under its original name so the e2e suites
  // in `tests/e2e/*` can keep calling `dispatch("stage/...")` /
  // reading `state.stage.X` without refactoring. Wave F deletes both
  // the Vuex facade and this hook in favour of `__UPSTAGE_PINIA__.stage`.
  window.__UPSTAGE_STORE__ = store;
  // Pinia (auth/cache/config/user/stage). Tests that previously read
  // `__UPSTAGE_STORE__.state.user.avatarId` etc. should switch to
  // `__UPSTAGE_PINIA__.user.avatarId`. We attach lazy getter functions
  // (rather than calling `useAuthStore()` etc. at load time) so the dev
  // hook works whether Pinia stores are first instantiated by the dev
  // hook reader or by the regular consumer.
  void Promise.all([
    import("./store/pinia/auth"),
    import("./store/pinia/cache"),
    import("./store/pinia/config"),
    import("./store/pinia/user"),
    import("./store/pinia/stage"),
  ]).then(
    ([
      { useAuthStore },
      { useCacheStore },
      { useConfigStore },
      { useUserStore },
      { useStageStore },
    ]) => {
      window.__UPSTAGE_PINIA__ = {
        get auth() {
          return useAuthStore();
        },
        get cache() {
          return useCacheStore();
        },
        get config() {
          return useConfigStore();
        },
        get user() {
          return useUserStore();
        },
        // Pinia stage store — after Wave E, this is the authoritative
        // source for stage state. The Vuex hook above is a thin
        // forwarder that routes back here. Migrate e2e helpers to use
        // this directly in Wave F.
        get stage() {
          return useStageStore();
        },
      };
    },
  );
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration: ServiceWorkerRegistration) => {
        console.log("Service Worker registered:", registration);

        // Check for updates
        registration.onupdatefound = () => {
          const installingWorker: ServiceWorker | null = registration.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
                // New content is available
                window.dispatchEvent(new Event("newVersionAvailable"));
              }
            };
          }
        };
      })
      .catch((error: unknown) => {
        console.error("Service Worker registration failed:", error);
      });
  });
}

app.mount("#app");
