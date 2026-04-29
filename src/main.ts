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

if (import.meta.env.DEV) {
  window.__UPSTAGE_STORE__ = store;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration: ServiceWorkerRegistration) => {
        console.log("Service Worker registered:", registration);

        // Check for updates
        registration.onupdatefound = () => {
          const installingWorker: ServiceWorker | null =
            registration.installing;
          if (installingWorker) {
            installingWorker.onstatechange = () => {
              if (
                installingWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
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
