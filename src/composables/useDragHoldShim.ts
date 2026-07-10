import { onBeforeUnmount, onMounted, type Ref } from "vue";

// The mobile-drag-drop polyfill (main.ts, holdToDrag: 300) aborts a pending
// touch drag on ANY touchmove before the hold completes — zero slop, so
// natural finger jitter on a tablet cancels most drag attempts. This shim
// hides sub-slop movement from the polyfill's per-touch abort listener while
// letting real swipes through (they should scroll the toolbox panel).
//
// Listener-ordering contract this relies on (mobile-drag-drop 3.0.0-rc.0,
// onDelayTouchstart): the polyfill registers its abort listener on the
// touched element at touchstart time, bubble phase. Our capture-phase
// listener is registered at mount, so it always runs first — capture beats
// bubble for touches on descendants, and registration order wins when the
// touch lands on the tile root itself.

// Below Android's own touch slop (~8px), so a move we swallow could never
// have started a native scroll anyway.
const THRESHOLD_PX = 8;

// holdToDrag (300ms, main.ts) + grace. MUST self-deactivate: once the hold
// completes, the polyfill's DragOperationController listens for touchmove on
// document and must see (and preventDefault) every one of them — swallowing
// events past this point would freeze the drag image and let the page pan.
const DEACTIVATE_MS = 350;

export function useDragHoldShim(elRef: Ref<HTMLElement | undefined>) {
  let startX = 0;
  let startY = 0;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deactivate = () => {
    active = false;
    clearTimeout(timer);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) {
      deactivate();
      return;
    }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    active = true;
    clearTimeout(timer);
    timer = setTimeout(deactivate, DEACTIVATE_MS);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!active) return;
    const t = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (dx * dx + dy * dy < THRESHOLD_PX * THRESHOLD_PX) {
      // Micro-jitter: keep it from the polyfill so the pending drag survives.
      // Passive listener — native scrolling is untouched (the browser's own
      // slop is >= ours, so nothing we swallow could have scrolled).
      e.stopImmediatePropagation();
    } else {
      // Deliberate swipe: let the polyfill abort so the panel can scroll.
      deactivate();
    }
  };

  // capture so we run before the polyfill's bubble-phase abort listener;
  // passive because we never preventDefault here.
  const OPTS: AddEventListenerOptions = { capture: true, passive: true };

  onMounted(() => {
    const el = elRef.value;
    if (!el) return;
    el.addEventListener("touchstart", onTouchStart, OPTS);
    el.addEventListener("touchmove", onTouchMove, OPTS);
    el.addEventListener("touchend", deactivate, OPTS);
    el.addEventListener("touchcancel", deactivate, OPTS);
  });

  onBeforeUnmount(() => {
    const el = elRef.value;
    deactivate();
    if (!el) return;
    el.removeEventListener("touchstart", onTouchStart, OPTS);
    el.removeEventListener("touchmove", onTouchMove, OPTS);
    el.removeEventListener("touchend", deactivate, OPTS);
    el.removeEventListener("touchcancel", deactivate, OPTS);
  });
}
