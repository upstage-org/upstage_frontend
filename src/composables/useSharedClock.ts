import { onMounted, onUnmounted, ref, type Ref } from "vue";

/**
 * One coarse clock shared by every subscriber, instead of one setInterval
 * per component. Topping.vue used to run a 1 Hz interval per board object
 * (each ticking its own `now` ref) just to expire speech bubbles; with a
 * busy stage that is dozens of timers waking the renderer every second.
 *
 * The interval runs only while at least one subscriber is mounted.
 */
const TICK_MS = 1000;

const now: Ref<number> = ref(Date.now());
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe() {
  subscribers += 1;
  if (timer == null) {
    now.value = Date.now();
    timer = setInterval(() => {
      now.value = Date.now();
    }, TICK_MS);
  }
}

function unsubscribe() {
  subscribers = Math.max(0, subscribers - 1);
  if (subscribers === 0 && timer != null) {
    clearInterval(timer);
    timer = null;
  }
}

/** A ref of `Date.now()` refreshed once a second while the caller is mounted. */
export function useSharedClock(): Ref<number> {
  onMounted(subscribe);
  onUnmounted(unsubscribe);
  return now;
}

/** Test hook: number of mounted subscribers and whether the interval is running. */
export function sharedClockState() {
  return { subscribers, running: timer != null };
}
