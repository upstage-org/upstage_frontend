/**
 * Starting frame for a multiframe autoplay run (board objects, backdrops,
 * curtains — Object.vue / Backdrop.vue / Curtain.vue all seed their
 * setInterval cycle through this).
 *
 * A play-once run (`frameLoop === false`) that would begin ON the final
 * frame has nowhere to advance: its first tick lands on `next >= length`
 * and stops the run before a single frame change. Since a finished
 * play-once run parks the displayed frame on the last one, every replay
 * after the first looked completely dead. Rewind exactly that case to
 * the first frame; looping runs (and mid-strip starts) keep their frame.
 */
export function autoplayStartFrame<T>(
  frames: readonly T[] | null | undefined,
  startFrame: T | null,
  frameLoop: boolean | undefined,
): T | null {
  if (frameLoop !== false) return startFrame;
  if (!frames?.length) return startFrame;
  return frames.indexOf(startFrame as T) === frames.length - 1 ? frames[0] : startFrame;
}

/**
 * True when two published copies of a backdrop differ ONLY in `opacity`
 * (plus the `at` publish timestamp every copy carries). Backdrop.vue uses
 * it to keep a running frame animation going while the opacity slider is
 * dragged; any other difference — speed, dwell, loop, frames, a frame
 * pick, a different backdrop — is a real change and restarts the run.
 *
 * Deliberately strict: identical copies (opacity unchanged too) return
 * false, so re-picking the current frame or re-applying a scene still
 * restarts exactly as before.
 */
export function isOpacityOnlyChange(
  previous: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): boolean {
  if (!previous || !next) return false;
  if (previous.opacity === next.opacity) return false;
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  keys.delete("opacity");
  keys.delete("at");
  for (const key of keys) {
    const a = previous[key];
    const b = next[key];
    if (a === b) continue;
    // `frames` arrives as a fresh array on every message.
    if (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => item === b[i])
    ) {
      continue;
    }
    return false;
  }
  return true;
}

/**
 * A multiframe animation run, as every browser on the stage agrees on it
 * (#1582 follow-up: "latecomers see exactly what everyone else sees").
 *
 * The frame on screen is never counted up by a local timer any more; it is
 * computed from how long ago the run started. The stage store records the
 * start (`startedAt`, this browser's clock) when the event that started the
 * run is applied — "now" for a live message, the archived event's own time
 * for someone who joins or reloads later, the recording's time in a replay.
 * So a viewer who arrives 100 s into a 300 s frame changes with everyone
 * else 200 s later, and one who arrives after the change is already on the
 * second frame.
 */
export interface FrameRun {
  /** The settings the run was started with (speed, loop…). */
  key: string;
  /** Unique per run: changes whenever a run starts, even with the same key. */
  token: number;
  /** `Date.now()`-scale time the run started, on this browser's clock. */
  startedAt: number;
  /** Picture the run started from (may be a still that is not in `frames`). */
  fromFrame: string | null;
}

export interface FramePosition<T> {
  frame: T | null;
  /** A play-once run has shown its last frame for a full step. */
  finished: boolean;
  /** Milliseconds until the frame next changes (or the run finishes). */
  nextChangeInMs: number | null;
}

/**
 * Where a run is `elapsedMs` after it started. Reproduces, step for step,
 * what the old per-component `setInterval` did: every `intervalMs` advance
 * one frame; a looping run wraps, a play-once run stops one step after it
 * reached the last frame; a start picture that is not one of the frames is
 * held for the first step and then gives way to frame one.
 */
export function framePosition<T>(
  frames: readonly T[] | null | undefined,
  fromFrame: T | null,
  frameLoop: boolean | undefined,
  intervalMs: number,
  elapsedMs: number,
): FramePosition<T> {
  if (!frames?.length || !(intervalMs > 0) || !Number.isFinite(intervalMs)) {
    return { frame: fromFrame, finished: false, nextChangeInMs: null };
  }
  const start = autoplayStartFrame(frames, fromFrame, frameLoop);
  const startIndex = frames.indexOf(start as T);
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const steps = Math.floor(elapsed / intervalMs);
  const nextChangeInMs = Math.max(1, intervalMs - (elapsed - steps * intervalMs));
  if (steps === 0) return { frame: start, finished: false, nextChangeInMs };
  const count = frames.length;
  if (frameLoop !== false) {
    return { frame: frames[(startIndex + steps) % count], finished: false, nextChangeInMs };
  }
  if (steps >= count - startIndex) {
    return { frame: frames[count - 1], finished: true, nextChangeInMs: null };
  }
  return { frame: frames[startIndex + steps], finished: false, nextChangeInMs };
}

/** Longest delay `setTimeout` takes before it overflows and fires at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export interface FrameCycleState<T> {
  frames: readonly T[] | null | undefined;
  frameLoop: boolean | undefined;
  intervalMs: number;
  startedAt: number;
  fromFrame: T | null;
}

/**
 * Keeps a displayed frame in step with a run. `sync()` works out the frame
 * for the present moment and sets one timer for the exact moment of the
 * next change, so nothing accumulates: a timer that fires late (a hidden
 * tab, a sleeping laptop) lands on the right frame when it does fire.
 * `getState` returning null stops the cycle.
 */
export function createFrameCycle<T>(options: {
  getState: () => FrameCycleState<T> | null;
  onFrame: (frame: T | null) => void;
  onFinished: (frame: T | null) => void;
  now?: () => number;
}) {
  const now = options.now ?? (() => Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
  };
  const sync = () => {
    stop();
    const state = options.getState();
    if (!state) return;
    const position = framePosition(
      state.frames,
      state.fromFrame,
      state.frameLoop,
      state.intervalMs,
      now() - state.startedAt,
    );
    options.onFrame(position.frame);
    if (position.finished) {
      options.onFinished(position.frame);
      return;
    }
    if (position.nextChangeInMs == null) return;
    timer = setTimeout(sync, Math.min(position.nextChangeInMs, MAX_TIMEOUT_MS));
  };
  return { sync, stop, running: () => timer != null };
}

/** Fixed `frameRuns` keys for the two single-instance layers. */
export const BACKGROUND_RUN = "__background__";
export const CURTAIN_RUN = "__curtain__";

/**
 * What makes a board object's autoplay one particular run: its speed, its
 * loop flag and `autoplayRunId` (stamped by the context menu each time a
 * player presses Enter or Play, so committing the same speed again starts
 * over). Null when the object is not animating.
 */
export function objectFrameRunKey(object: {
  multi?: unknown;
  autoplayFrames?: unknown;
  frameLoop?: unknown;
  autoplayRunId?: unknown;
}): string | null {
  if (!object.multi || !object.autoplayFrames) return null;
  const seconds = parseFloat(String(object.autoplayFrames));
  if (!(seconds > 0)) return null;
  return `${seconds}|${object.frameLoop !== false}|${object.autoplayRunId ?? ""}`;
}

/** Seconds per step of an animated backdrop or curtain: fade + hold. */
export function layerCycleMs(layer: { speed?: unknown; dwell?: unknown }): number {
  const fade = parseFloat(String(layer.speed ?? 0));
  const hold = parseFloat(String(layer.dwell ?? 0));
  const total = (Number.isFinite(fade) ? fade : 0) + (Number.isFinite(hold) ? hold : 0);
  return total * 1000;
}
