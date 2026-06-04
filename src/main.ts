import $ from "jquery";
// `public/js/jitsi/lib-jitsi-meet.min.js` (see index.html) still references a global jQuery
window.jQuery = window.$ = $;

import { createApp } from "vue";
import App from "./App.vue";
import i18n from "./i18n";
import "./styles/studio.less";
import { router } from "router";
import { pinia } from "./store/pinia";
import "@fortawesome/fontawesome-free/css/all.css";
import ClickOutside from "./directives/ClickOutside";
import { installApolloClient } from "./apollo";

// HTML5 drag-and-drop has no native support on iOS Safari and is patchy on
// Android Chrome. The polyfill synthesises the standard `dragstart` /
// `dragover` / `drop` events from touch events on `[draggable=true]`
// elements, so the existing handlers in Skeleton.vue, Reorder.vue, Board.vue
// and Dropzone.vue work uniformly across desktop Chromium / Firefox / Safari
// and iPad / iPhone Safari without any per-call-site changes. `holdToDrag`
// keeps page scrolling responsive: a quick swipe scrolls the page; a
// 300ms press starts the drag.
import { polyfill as mobileDragDropPolyfill } from "mobile-drag-drop";
import "mobile-drag-drop/default.css";

mobileDragDropPolyfill({
  holdToDrag: 300,
});

installApolloClient();
const app = createApp(App)
  .use(pinia)
  .use(router)
  .use(i18n)
  .directive("click-outside", ClickOutside);

if (import.meta.env.DEV || import.meta.env.VITE_E2E) {
  // Pinia dev hook (auth/cache/config/user/stage). Tests reach in via
  // `window.__UPSTAGE_PINIA__.stage.placeObjectOnStage(...)` etc.; see
  // `tests/e2e/pages/LiveStagePage.ts` and `tests/e2e/perform.spec.ts`
  // for usage. We attach lazy getter functions (rather than calling
  // `useAuthStore()` etc. at load time) so the dev hook works whether
  // a given store is first instantiated by the dev-hook reader or by
  // the regular consumer.
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
        get stage() {
          return useStageStore();
        },
      };
    },
  );
}

// The app used to register a no-op passthrough Service Worker
// (public/service-worker.js). It cached nothing, added console noise, and
// made cache-busting harder, so it has been removed. We no longer register a
// worker; instead we proactively unregister any that a returning visitor
// still has installed. The self-unregistering public/service-worker.js covers
// browsers that re-check the file before this code runs. Version-update
// notifications are unaffected — App.vue polls /version.json directly.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      registrations.forEach((registration) => void registration.unregister());
    })
    .catch(() => {
      /* best-effort: nothing to do if unregistering fails */
    });
}

app.mount("#app");
