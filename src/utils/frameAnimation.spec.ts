import { describe, expect, it } from "vitest";
import { autoplayStartFrame } from "./frameAnimation";

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
