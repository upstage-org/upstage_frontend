import { describe, expect, it } from "vitest";
import { isHoldableBoardObject } from "./common";

describe("isHoldableBoardObject", () => {
  it("includes avatars only", () => {
    expect(isHoldableBoardObject({ type: "avatar" })).toBe(true);
  });

  it("excludes stream tiles (video/stream/jitsi) — they behave as props now", () => {
    expect(isHoldableBoardObject({ type: "video" })).toBe(false);
    expect(isHoldableBoardObject({ type: "stream" })).toBe(false);
    expect(isHoldableBoardObject({ type: "jitsi" })).toBe(false);
  });

  it("excludes props, meetings, and other board types", () => {
    expect(isHoldableBoardObject({ type: "prop" })).toBe(false);
    expect(isHoldableBoardObject({ type: "meeting" })).toBe(false);
    expect(isHoldableBoardObject({ type: "text" })).toBe(false);
    expect(isHoldableBoardObject(null)).toBe(false);
  });
});
