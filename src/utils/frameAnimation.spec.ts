import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  autoplayStartFrame,
  createFrameCycle,
  framePosition,
  isOpacityOnlyChange,
  layerCycleMs,
  objectFrameRunKey,
  type FrameCycleState,
} from "./frameAnimation";

const FRAMES = ["f1.png", "f2.png", "f3.png"];

describe("autoplayStartFrame", () => {
  it("keeps the current frame for looping runs (frameLoop omitted or true)", () => {
    expect(autoplayStartFrame(FRAMES, "f3.png", undefined)).toBe("f3.png");
    expect(autoplayStartFrame(FRAMES, "f3.png", true)).toBe("f3.png");
  });

  it("rewinds a play-once run that would start on the final frame", () => {
    // The dead-end this fixes: a finished play-once run parks src on the
    // last frame, so the next run's first tick stopped it before a single
    // frame change — "loop off doesn't animate at all".
    expect(autoplayStartFrame(FRAMES, "f3.png", false)).toBe("f1.png");
  });

  it("keeps a mid-strip start for play-once runs", () => {
    expect(autoplayStartFrame(FRAMES, "f1.png", false)).toBe("f1.png");
    expect(autoplayStartFrame(FRAMES, "f2.png", false)).toBe("f2.png");
  });

  it("keeps a start frame that is not in the frame list (tick wraps it to frame one)", () => {
    expect(autoplayStartFrame(FRAMES, "asset-src.png", false)).toBe("asset-src.png");
    expect(autoplayStartFrame(FRAMES, null, false)).toBe(null);
  });

  it("tolerates a missing or empty frame list", () => {
    expect(autoplayStartFrame(null, "f1.png", false)).toBe("f1.png");
    expect(autoplayStartFrame(undefined, "f1.png", false)).toBe("f1.png");
    expect(autoplayStartFrame([], "f1.png", false)).toBe("f1.png");
  });

  it("is a no-op for a single-frame strip", () => {
    expect(autoplayStartFrame(["only.png"], "only.png", false)).toBe("only.png");
  });
});

describe("isOpacityOnlyChange", () => {
  const bg = {
    id: 7,
    src: "f1.png",
    multi: true,
    frames: [...FRAMES],
    speed: 1,
    dwell: 299,
    opacity: 1,
    at: 1000,
  };

  it("is true when only opacity (and the publish timestamp) differ", () => {
    expect(isOpacityOnlyChange(bg, { ...bg, opacity: 0.4, at: 2000 })).toBe(true);
  });

  it("treats an equal-content fresh frames array as unchanged", () => {
    expect(isOpacityOnlyChange(bg, { ...bg, frames: [...FRAMES], opacity: 0.4 })).toBe(true);
  });

  it("is false for identical copies, so a re-pick or scene re-apply still restarts", () => {
    expect(isOpacityOnlyChange(bg, { ...bg, at: 2000 })).toBe(false);
  });

  it.each([
    ["speed", { speed: 2 }],
    ["dwell", { dwell: 10 }],
    ["frameLoop", { frameLoop: false }],
    ["currentFrame", { currentFrame: "f2.png" }],
    ["a different backdrop", { id: 8 }],
    ["frames content", { frames: ["f1.png", "f3.png", "f2.png"] }],
    ["frames length", { frames: ["f1.png"] }],
    ["a removed key", { dwell: undefined }],
  ])("is false when %s changes along with opacity", (_name, patch) => {
    expect(isOpacityOnlyChange(bg, { ...bg, ...patch, opacity: 0.4 })).toBe(false);
  });

  it("is false when either side is missing", () => {
    expect(isOpacityOnlyChange(null, bg)).toBe(false);
    expect(isOpacityOnlyChange(bg, undefined)).toBe(false);
  });
});

describe("framePosition", () => {
  const at = (
    elapsed: number,
    from: string | null = "f1.png",
    loop?: boolean,
    interval = 300_000,
  ) => framePosition(FRAMES, from, loop, interval, elapsed);

  it("holds the start frame for the whole first step and reports the time left", () => {
    expect(at(0)).toEqual({ frame: "f1.png", finished: false, nextChangeInMs: 300_000 });
    expect(at(100_000)).toEqual({ frame: "f1.png", finished: false, nextChangeInMs: 200_000 });
    expect(at(299_999)).toEqual({ frame: "f1.png", finished: false, nextChangeInMs: 1 });
  });

  it("advances one frame per step and wraps when looping", () => {
    expect(at(300_000).frame).toBe("f2.png");
    expect(at(599_999).frame).toBe("f2.png");
    expect(at(600_000).frame).toBe("f3.png");
    expect(at(900_000).frame).toBe("f1.png");
    expect(at(300_000 * 3001 + 5).frame).toBe("f2.png");
  });

  it("starts mid-strip from the given frame", () => {
    expect(at(0, "f2.png").frame).toBe("f2.png");
    expect(at(300_000, "f2.png").frame).toBe("f3.png");
    expect(at(600_000, "f2.png").frame).toBe("f1.png");
  });

  it("holds a start picture that is not a frame for one step, then shows frame one", () => {
    expect(at(0, "still.png").frame).toBe("still.png");
    expect(at(299_999, "still.png").frame).toBe("still.png");
    expect(at(300_000, "still.png").frame).toBe("f1.png");
    expect(at(600_000, "still.png").frame).toBe("f2.png");
  });

  it("a play-once run finishes one step after reaching the last frame", () => {
    expect(at(600_000, "f1.png", false)).toMatchObject({ frame: "f3.png", finished: false });
    expect(at(899_999, "f1.png", false)).toMatchObject({ frame: "f3.png", finished: false });
    expect(at(900_000, "f1.png", false)).toEqual({
      frame: "f3.png",
      finished: true,
      nextChangeInMs: null,
    });
    expect(at(9e12, "f1.png", false)).toMatchObject({ frame: "f3.png", finished: true });
  });

  it("a play-once run started on the last frame rewinds to the first", () => {
    expect(at(0, "f3.png", false).frame).toBe("f1.png");
    expect(at(300_000, "f3.png", false).frame).toBe("f2.png");
  });

  it("a play-once run from a still that is not a frame plays every frame", () => {
    expect(at(300_000, "still.png", false).frame).toBe("f1.png");
    expect(at(900_000, "still.png", false)).toMatchObject({ frame: "f3.png", finished: false });
    expect(at(1_200_000, "still.png", false)).toMatchObject({ frame: "f3.png", finished: true });
  });

  it("matches a step-by-step interval for every start, loop setting and step count", () => {
    // The old implementation, verbatim in miniature.
    const simulate = (from: string | null, loop: boolean | undefined, ticks: number) => {
      let current = autoplayStartFrame(FRAMES, from, loop);
      let finished = false;
      for (let i = 0; i < ticks && !finished; i += 1) {
        const next = FRAMES.indexOf(current as string) + 1;
        if (next >= FRAMES.length) {
          if (loop !== false) current = FRAMES[0];
          else finished = true;
        } else {
          current = FRAMES[next];
        }
      }
      return { frame: current, finished };
    };
    for (const from of [...FRAMES, "still.png", null]) {
      for (const loop of [undefined, true, false]) {
        for (let ticks = 0; ticks <= 9; ticks += 1) {
          const got = framePosition(FRAMES, from, loop, 1000, ticks * 1000 + 500);
          expect({ frame: got.frame, finished: got.finished }, `${from} ${loop} ${ticks}`).toEqual(
            simulate(from, loop, ticks),
          );
        }
      }
    }
  });

  it("treats a negative or invalid elapsed time as the start", () => {
    expect(at(-5_000).frame).toBe("f1.png");
    expect(at(NaN)).toMatchObject({ frame: "f1.png", nextChangeInMs: 300_000 });
  });

  it("does not run without frames or a positive interval", () => {
    expect(framePosition([], "x.png", true, 1000, 5000)).toEqual({
      frame: "x.png",
      finished: false,
      nextChangeInMs: null,
    });
    expect(framePosition(FRAMES, "f1.png", true, 0, 5000).nextChangeInMs).toBeNull();
    expect(framePosition(FRAMES, "f1.png", true, NaN, 5000).nextChangeInMs).toBeNull();
  });
});

describe("createFrameCycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (state: Partial<FrameCycleState<string>> & { startedAt: number }) => {
    const shown: Array<string | null> = [];
    const finished: Array<string | null> = [];
    let current: FrameCycleState<string> | null = {
      frames: FRAMES,
      frameLoop: undefined,
      intervalMs: 300_000,
      fromFrame: "f1.png",
      ...state,
    };
    const cycle = createFrameCycle<string>({
      getState: () => current,
      onFrame: (f) => {
        if (shown[shown.length - 1] !== f) shown.push(f);
      },
      onFinished: (f) => finished.push(f),
    });
    return {
      cycle,
      shown,
      finished,
      set: (s: FrameCycleState<string> | null) => {
        current = s;
      },
    };
  };

  it("changes frame exactly on each step from the run's start, with a single timer", () => {
    const { cycle, shown } = setup({ startedAt: Date.now() });
    cycle.sync();
    expect(shown).toEqual(["f1.png"]);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(299_999);
    expect(shown).toEqual(["f1.png"]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual(["f1.png", "f2.png"]);
    vi.advanceTimersByTime(600_000);
    expect(shown).toEqual(["f1.png", "f2.png", "f3.png", "f1.png"]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("joins a run already under way at the right frame and changes with it", () => {
    // Started 400 s ago: one change has happened, the next is in 200 s.
    const { cycle, shown } = setup({ startedAt: Date.now() - 400_000 });
    cycle.sync();
    expect(shown).toEqual(["f2.png"]);
    vi.advanceTimersByTime(199_999);
    expect(shown).toEqual(["f2.png"]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual(["f2.png", "f3.png"]);
  });

  it("re-syncing mid-step neither restarts nor shifts the timing", () => {
    const { cycle, shown } = setup({ startedAt: Date.now() });
    cycle.sync();
    for (let i = 0; i < 29; i += 1) {
      vi.advanceTimersByTime(10_000);
      cycle.sync();
    }
    expect(shown).toEqual(["f1.png"]);
    vi.advanceTimersByTime(9_999);
    expect(shown).toEqual(["f1.png"]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual(["f1.png", "f2.png"]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("a timer that fires late lands on the frame for the actual time", () => {
    const { cycle, shown } = setup({ startedAt: Date.now() });
    cycle.sync();
    // The tab slept through two changes; the clock moved, no timer ran.
    vi.setSystemTime(Date.now() + 700_000);
    cycle.sync();
    expect(shown).toEqual(["f1.png", "f3.png"]);
    vi.advanceTimersByTime(200_000);
    expect(shown).toEqual(["f1.png", "f3.png", "f1.png"]);
  });

  it("reports the end of a play-once run once and stops", () => {
    const { cycle, shown, finished } = setup({ startedAt: Date.now(), frameLoop: false });
    cycle.sync();
    vi.advanceTimersByTime(900_000);
    expect(shown).toEqual(["f1.png", "f2.png", "f3.png"]);
    expect(finished).toEqual(["f3.png"]);
    expect(cycle.running()).toBe(false);
    vi.advanceTimersByTime(900_000);
    expect(finished).toEqual(["f3.png"]);
  });

  it("stop() cancels the pending change; a null state stops too", () => {
    const a = setup({ startedAt: Date.now() });
    a.cycle.sync();
    a.cycle.stop();
    vi.advanceTimersByTime(900_000);
    expect(a.shown).toEqual(["f1.png"]);
    expect(vi.getTimerCount()).toBe(0);

    const b = setup({ startedAt: Date.now() });
    b.cycle.sync();
    b.set(null);
    b.cycle.sync();
    expect(b.cycle.running()).toBe(false);
  });

  it("survives a step longer than setTimeout can hold", () => {
    const month = 40 * 24 * 3600 * 1000;
    const { cycle, shown } = setup({ startedAt: Date.now(), intervalMs: month });
    cycle.sync();
    vi.advanceTimersByTime(month - 1);
    expect(shown).toEqual(["f1.png"]);
    vi.advanceTimersByTime(1);
    expect(shown).toEqual(["f1.png", "f2.png"]);
  });
});

describe("objectFrameRunKey / layerCycleMs", () => {
  const prop = { multi: true, autoplayFrames: 300 };
  it("is null when the object is not animating", () => {
    expect(objectFrameRunKey({ autoplayFrames: 300 })).toBeNull();
    expect(objectFrameRunKey({ multi: true })).toBeNull();
    expect(objectFrameRunKey({ multi: true, autoplayFrames: null })).toBeNull();
    expect(objectFrameRunKey({ multi: true, autoplayFrames: 0 })).toBeNull();
    expect(objectFrameRunKey({ multi: true, autoplayFrames: -2 })).toBeNull();
    expect(objectFrameRunKey({ multi: true, autoplayFrames: "abc" })).toBeNull();
  });
  it("is the same for the same run however the speed is typed", () => {
    expect(objectFrameRunKey(prop)).toBe(objectFrameRunKey({ ...prop, autoplayFrames: "300" }));
    expect(objectFrameRunKey(prop)).toBe(objectFrameRunKey({ ...prop, frameLoop: true }));
  });
  it("changes with speed, loop flag and run id", () => {
    const base = objectFrameRunKey(prop);
    expect(objectFrameRunKey({ ...prop, autoplayFrames: 30 })).not.toBe(base);
    expect(objectFrameRunKey({ ...prop, frameLoop: false })).not.toBe(base);
    expect(objectFrameRunKey({ ...prop, autoplayRunId: 17 })).not.toBe(base);
  });
  it("layerCycleMs is fade plus hold, tolerant of strings and gaps", () => {
    expect(layerCycleMs({ speed: 1, dwell: 299 })).toBe(300_000);
    expect(layerCycleMs({ speed: "0.5" })).toBe(500);
    expect(layerCycleMs({})).toBe(0);
    expect(layerCycleMs({ speed: "x", dwell: 2 })).toBe(2000);
  });
});
