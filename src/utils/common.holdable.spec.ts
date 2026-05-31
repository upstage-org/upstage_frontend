import { describe, expect, it } from "vitest";
import { isHoldableBoardObject } from "./common";

describe("isHoldableBoardObject", () => {
  it("includes regular avatars, stream video, and jitsi tiles", () => {
    expect(isHoldableBoardObject({ type: "avatar" })).toBe(true);
    expect(isHoldableBoardObject({ type: "video" })).toBe(true);
    expect(isHoldableBoardObject({ type: "stream" })).toBe(true);
    expect(isHoldableBoardObject({ type: "jitsi" })).toBe(true);
  });

  it("excludes props, meetings, and other board types", () => {
    expect(isHoldableBoardObject({ type: "prop" })).toBe(false);
    expect(isHoldableBoardObject({ type: "meeting" })).toBe(false);
    expect(isHoldableBoardObject({ type: "text" })).toBe(false);
    expect(isHoldableBoardObject(null)).toBe(false);
  });
});
