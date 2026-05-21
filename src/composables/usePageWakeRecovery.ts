import { onMounted, onUnmounted } from "vue";
import { isWebKit } from "@utils/browser";

/**
 * Run `onWake` when the tab becomes visible again or is restored from
 * bfcache — common after iOS Safari backgrounds a live stage tab.
 */
export function usePageWakeRecovery(onWake: () => void): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  const runIfVisible = () => {
    if (document.visibilityState === "visible") onWake();
  };

  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) runIfVisible();
  };

  onMounted(() => {
    document.addEventListener("visibilitychange", runIfVisible);
    window.addEventListener("pageshow", onPageShow);
    // WebKit is where background-tab media loss is most common.
    if (isWebKit()) {
      window.addEventListener("focus", runIfVisible);
    }
  });

  onUnmounted(() => {
    document.removeEventListener("visibilitychange", runIfVisible);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("focus", runIfVisible);
  });
}
