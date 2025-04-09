import { createApp } from "vue";
import App from "./App.vue";
import i18n from "./i18n";
import "./styles/studio.less";
import { router } from "router";
import store from "./store";
import "@fortawesome/fontawesome-free/css/all.css";
import ClickOutside from "./directives/ClickOutside";
const app = createApp(App)
  .use(store)
  .use(router)
  .use(i18n)
  .directive("click-outside", ClickOutside);

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
