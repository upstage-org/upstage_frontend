import { describe, expect, it } from "vitest";
import { isRtmpStreamDescription } from "./common";

/**
 * The isRTMP flag is what routes a stage asset into LiveStreamPlayer
 * (Object.vue) instead of the plain <video src> path. Anything that is not
 * an explicit `{"isRTMP": true}` must classify as NOT RTMP so pre-existing
 * uploaded clips keep their exact current behavior.
 */
describe("isRtmpStreamDescription", () => {
  it("accepts the backend's stream-asset description", () => {
    expect(isRtmpStreamDescription(JSON.stringify({ isRTMP: true, w: 16, h: 9 }))).toBe(true);
  });

  it("rejects uploaded-video descriptions (no flag)", () => {
    expect(isRtmpStreamDescription(JSON.stringify({ multi: false, frames: [] }))).toBe(false);
  });

  it("rejects a non-boolean flag", () => {
    expect(isRtmpStreamDescription(JSON.stringify({ isRTMP: "yes" }))).toBe(false);
  });

  it("rejects empty / missing / invalid descriptions", () => {
    expect(isRtmpStreamDescription("")).toBe(false);
    expect(isRtmpStreamDescription(undefined)).toBe(false);
    expect(isRtmpStreamDescription(null)).toBe(false);
    expect(isRtmpStreamDescription("not json {")).toBe(false);
    expect(isRtmpStreamDescription(JSON.stringify(null))).toBe(false);
    expect(isRtmpStreamDescription(JSON.stringify("isRTMP"))).toBe(false);
  });

  it("rejects non-string inputs (defensive against loose call sites)", () => {
    expect(isRtmpStreamDescription({ isRTMP: true })).toBe(false);
    expect(isRtmpStreamDescription(42)).toBe(false);
  });
});
