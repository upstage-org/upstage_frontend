import { onUnmounted, ref, watch, type Ref } from "vue";

/**
 * Detects when a remote Jitsi video tile has stopped receiving frames (a
 * "frozen" stream) on the VIEWER side.
 *
 * Primary signal is `HTMLVideoElement.requestVideoFrameCallback` (rVFC), which
 * fires once per *presented* frame — the authoritative "a new frame was
 * actually rendered" event. We stamp `lastFrameTs` on every frame; a 1s poll
 * flags `frozen` when no frame has arrived for `FREEZE_THRESHOLD_MS`.
 *
 * Gotchas handled:
 *  - rVFC STOPS firing when the tab is hidden or the <video> is not being
 *    rendered, which would look identical to a freeze. So the check only runs
 *    when `document.visibilityState === "visible"`, the element is playing
 *    (`!paused`) and the tile actually carries video (`hasVideo`). Whenever
 *    those conditions are false we keep `lastFrameTs` fresh so returning to a
 *    checkable state never yields an instant false positive.
 *  - Firefox added rVFC in 132; older engines fall back to sampling
 *    `currentTime` advancement (coarser, but only used when rVFC is absent).
 *  - Audio-only tiles (`hasVideo` false) never flag.
 *
 * The detector is self-healing: any new frame (or currentTime advance) clears
 * `frozen`. Returns a reactive `frozen` ref; all timers/handles are cleaned up
 * on unmount.
 */

const FREEZE_THRESHOLD_MS = 3000;
const CHECK_INTERVAL_MS = 1000;

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function useStreamFreezeDetector(
  videoEl: Ref<HTMLVideoElement | undefined>,
  hasVideo: Ref<boolean>,
) {
  const frozen = ref(false);

  let lastFrameTs = nowMs();
  let lastCurrentTime = -1;
  let rvfcHandle: number | null = null;
  let scheduledEl: RvfcVideo | null = null;
  let checkTimer: ReturnType<typeof setInterval> | null = null;

  const markFrame = () => {
    lastFrameTs = nowMs();
    if (frozen.value) frozen.value = false;
  };

  const cancelRvfc = () => {
    if (scheduledEl && rvfcHandle != null && scheduledEl.cancelVideoFrameCallback) {
      try {
        scheduledEl.cancelVideoFrameCallback(rvfcHandle);
      } catch {
        /* element already gone */
      }
    }
    rvfcHandle = null;
    scheduledEl = null;
  };

  const scheduleRvfc = () => {
    const el = videoEl.value as RvfcVideo | undefined;
    if (!el || typeof el.requestVideoFrameCallback !== "function") return;
    // A frame was presented; stamp it and re-arm for the next one.
    scheduledEl = el;
    rvfcHandle = el.requestVideoFrameCallback(() => {
      markFrame();
      scheduleRvfc();
    });
  };

  const rvfcSupported = (): boolean => {
    const el = videoEl.value as RvfcVideo | undefined;
    return !!el && typeof el.requestVideoFrameCallback === "function";
  };

  const checkable = (): boolean =>
    !!videoEl.value &&
    hasVideo.value &&
    !videoEl.value.paused &&
    (typeof document === "undefined" || document.visibilityState === "visible");

  const check = () => {
    if (!checkable()) {
      // Not in a state where "no frames" reliably means "frozen" — keep the
      // clock fresh so we don't instantly false-positive when it becomes
      // checkable again.
      lastFrameTs = nowMs();
      if (frozen.value) frozen.value = false;
      return;
    }
    if (!rvfcSupported()) {
      // Fallback path: treat a currentTime advance as a frame.
      const el = videoEl.value!;
      if (el.currentTime !== lastCurrentTime) {
        lastCurrentTime = el.currentTime;
        lastFrameTs = nowMs();
      }
    }
    const stale = nowMs() - lastFrameTs > FREEZE_THRESHOLD_MS;
    if (stale !== frozen.value) frozen.value = stale;
  };

  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      // Coming back to the foreground: rVFC was paused, so reset the clock and
      // re-arm rather than reporting a spurious freeze.
      lastFrameTs = nowMs();
      cancelRvfc();
      scheduleRvfc();
    }
  };

  // Re-arm rVFC whenever the <video> element instance changes (remount / DOM
  // branch flip) and reset the freeze clock so the fresh element gets a grace
  // period before it can be judged frozen.
  watch(
    videoEl,
    () => {
      cancelRvfc();
      lastFrameTs = nowMs();
      lastCurrentTime = -1;
      if (frozen.value) frozen.value = false;
      scheduleRvfc();
    },
    { immediate: true },
  );

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  checkTimer = setInterval(check, CHECK_INTERVAL_MS);

  onUnmounted(() => {
    cancelRvfc();
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = null;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  });

  return { frozen };
}
