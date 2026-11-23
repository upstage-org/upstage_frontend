import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVolumeFader, FADE_STEP_MS } from "./volumeFade";

/**
 * Volume ramps must not need animation frames: a background tab gets none,
 * and stage audio is what people leave playing there (see volumeFade.ts).
 * `requestAnimationFrame` is replaced by a spy that never calls back, as in
 * a hidden tab; every test below would hang at the starting level if the
 * ramp depended on it.
 */
describe("createVolumeFader", () => {
  let raf: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("ramps linearly to the target over the duration without animation frames", () => {
    const fader = createVolumeFader();
    const el = { volume: 1 };
    fader.fade(el, 0.2, 1000);
    expect(el.volume).toBe(1);
    vi.advanceTimersByTime(500);
    expect(el.volume).toBeCloseTo(0.6, 1);
    expect(fader.isFading(el)).toBe(true);
    vi.advanceTimersByTime(500);
    expect(el.volume).toBe(0.2);
    expect(fader.isFading(el)).toBe(false);
    expect(raf).not.toHaveBeenCalled();
  });

  it("passes through intermediate levels on the way down (a fade, not a cut)", () => {
    const fader = createVolumeFader();
    const el = { volume: 0.8 };
    const seen: number[] = [];
    fader.fade(el, 0, 3000);
    for (let t = 0; t < 3000; t += 250) {
      vi.advanceTimersByTime(250);
      seen.push(el.volume);
    }
    expect(seen[seen.length - 1]).toBe(0);
    expect(seen.filter((v) => v > 0.08 && v < 0.72).length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeLessThanOrEqual(seen[i - 1]);
  });

  it("applies a zero-duration change at once", () => {
    const fader = createVolumeFader();
    const el = { volume: 1 };
    fader.fade(el, 0.35, 0);
    expect(el.volume).toBe(0.35);
    expect(fader.isFading(el)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a new ramp replaces the one still running on the same element", () => {
    const fader = createVolumeFader();
    const el = { volume: 1 };
    fader.fade(el, 0, 3000);
    vi.advanceTimersByTime(1500);
    const mid = el.volume;
    expect(mid).toBeCloseTo(0.5, 1);
    // e.g. Stop all + master reset arriving in the middle of a fade out.
    fader.fade(el, 1, 0);
    expect(el.volume).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(el.volume).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends at the right level at the right time when the timer is throttled", () => {
    // A hidden, silent page may get one timer tick a second. Levels come
    // from the clock, so the ramp is coarse but neither late nor short.
    let clock = 0;
    const fader = createVolumeFader({ now: () => clock });
    const el = { volume: 1 };
    fader.fade(el, 0, 3000);
    // Only every 50th tick "gets through": move the clock a second at a time.
    clock = 1000;
    vi.advanceTimersByTime(FADE_STEP_MS);
    expect(el.volume).toBeCloseTo(2 / 3, 5);
    clock = 2000;
    vi.advanceTimersByTime(FADE_STEP_MS);
    expect(el.volume).toBeCloseTo(1 / 3, 5);
    clock = 3100;
    vi.advanceTimersByTime(FADE_STEP_MS);
    expect(el.volume).toBe(0);
    expect(fader.isFading(el)).toBe(false);
  });

  it("never sets a level outside 0..1 (the element would throw)", () => {
    const fader = createVolumeFader();
    const el = { volume: 0.5 };
    fader.fade(el, 1.4, 0);
    expect(el.volume).toBe(1);
    fader.fade(el, -0.3, 200);
    vi.advanceTimersByTime(200);
    expect(el.volume).toBe(0);
  });

  it("ignores a level that is not a number and leaves the element alone", () => {
    const fader = createVolumeFader();
    const el = { volume: 0.5 };
    fader.fade(el, Number.NaN, 500);
    vi.advanceTimersByTime(500);
    expect(el.volume).toBe(0.5);
  });

  it("ramps several elements independently; cancel and dispose stop them", () => {
    const fader = createVolumeFader();
    const a = { volume: 1 };
    const b = { volume: 0 };
    const c = { volume: 1 };
    fader.fade(a, 0, 1000);
    fader.fade(b, 1, 1000);
    fader.fade(c, 0, 1000);
    vi.advanceTimersByTime(500);
    fader.cancel(c);
    const cAt = c.volume;
    vi.advanceTimersByTime(500);
    expect(a.volume).toBe(0);
    expect(b.volume).toBe(1);
    expect(c.volume).toBe(cAt);
    fader.fade(a, 1, 1000);
    fader.dispose();
    vi.advanceTimersByTime(1000);
    expect(a.volume).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
