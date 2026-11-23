/**
 * Volume ramps for stage audio, driven by a timer and the clock.
 *
 * The ramps used to be animated with anime.js, which advances on
 * `requestAnimationFrame` and pauses itself while the document is hidden.
 * A browser delivers no animation frames to a tab that is in the background
 * (another tab in front, a minimised or covered window), so there every
 * ramp simply never ran: a track's own volume slider changed nothing, and
 * "Fade out" held the level and then cut the track off when the stop
 * arrived — while the master volume slider, which applies instantly (no
 * ramp), kept working. Sound is exactly the thing people leave playing in a
 * background tab, and a performer who has the stage open in a second browser
 * hears that copy too. Reproduced in Chrome and Firefox 2026-11-24
 * (tests/e2e/audio.spec.ts, "a seat whose tab is in the background…").
 *
 * Timers keep running in a hidden tab. A browser may slow them down there
 * (Chrome: at most once a second for a page that is not audible), which is
 * why each step computes the level from the elapsed time instead of adding
 * an increment: a throttled ramp is coarser but still ends at the right
 * level at the right moment.
 */

/** Interval between ramp steps. */
export const FADE_STEP_MS = 20;

/** Anything with a 0..1 `volume`, i.e. an `<audio>` / `<video>` element. */
export type VolumeTarget = { volume: number };

export type VolumeFader = ReturnType<typeof createVolumeFader>;

export function createVolumeFader(deps: { now?: () => number } = {}) {
  const now = deps.now ?? (() => performance.now());
  const running = new Map<VolumeTarget, ReturnType<typeof setInterval>>();
  // `HTMLMediaElement.volume` throws outside 0..1.
  const clamp = (value: number) => Math.min(1, Math.max(0, value));

  const cancel = (target: VolumeTarget) => {
    const timer = running.get(target);
    if (timer === undefined) return;
    clearInterval(timer);
    running.delete(target);
  };

  /**
   * Move `target.volume` to `to` over `duration` ms, linearly, replacing any
   * ramp still running on that target. `duration <= 0` applies it at once.
   */
  const fade = (target: VolumeTarget, to: number, duration = 0) => {
    cancel(target);
    if (!Number.isFinite(to)) return;
    const goal = clamp(to);
    const from = target.volume;
    if (!(duration > 0) || from === goal) {
      target.volume = goal;
      return;
    }
    const startedAt = now();
    const step = () => {
      const progress = Math.min(1, (now() - startedAt) / duration);
      target.volume = progress >= 1 ? goal : clamp(from + (goal - from) * progress);
      if (progress >= 1) cancel(target);
    };
    running.set(target, setInterval(step, FADE_STEP_MS));
  };

  const isFading = (target: VolumeTarget) => running.has(target);

  const dispose = () => {
    running.forEach((timer) => clearInterval(timer));
    running.clear();
  };

  return { fade, cancel, isFading, dispose };
}
