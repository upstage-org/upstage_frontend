// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

describe("meeting wearers (#1566 follow-up)", () => {
  it("a prop worn by a meeting has an unheld wearer, like one on a stream", async () => {
    const { streamWearerOf, isMeetingObject, isUnheldWearerObject, isStreamTileObject } =
      await import("./common");
    const objects = [
      { id: "m", type: "meeting" },
      { id: "a", type: "avatar" },
      { id: "p1", type: "prop", wornBy: "m" },
    ];
    expect(streamWearerOf(objects[2], objects)?.id).toBe("m");
    expect(isMeetingObject(objects[0])).toBe(true);
    expect(isMeetingObject(objects[1])).toBe(false);
    expect(isMeetingObject(null)).toBe(false);
    expect(isUnheldWearerObject(objects[0])).toBe(true);
    expect(isUnheldWearerObject({ type: "jitsi" })).toBe(true);
    expect(isUnheldWearerObject(objects[1])).toBe(false);
    // a meeting is not a stream tile: it keeps its own menu and rendering
    expect(isStreamTileObject(objects[0])).toBe(false);
  });
});

describe("stream tile wearers (#1566)", () => {
  it("recognises jitsi, RTMP and video tiles and nothing else", async () => {
    const { isStreamTileObject } = await import("./common");
    expect(isStreamTileObject({ type: "jitsi" })).toBe(true);
    expect(isStreamTileObject({ type: "video", isRTMP: true })).toBe(true);
    expect(isStreamTileObject({ type: "video" })).toBe(true);
    expect(isStreamTileObject({ type: "avatar" })).toBe(false);
    expect(isStreamTileObject({ type: "prop" })).toBe(false);
    expect(isStreamTileObject(null)).toBe(false);
  });

  it("finds the stream a prop is worn by, but not an avatar", async () => {
    const { streamWearerOf } = await import("./common");
    const objects = [
      { id: "s", type: "jitsi" },
      { id: "a", type: "avatar" },
      { id: "p1", type: "prop", wornBy: "s" },
      { id: "p2", type: "prop", wornBy: "a" },
      { id: "p3", type: "prop", wornBy: "gone" },
    ];
    expect(streamWearerOf(objects[2], objects)?.id).toBe("s");
    expect(streamWearerOf(objects[3], objects)).toBeNull();
    expect(streamWearerOf(objects[4], objects)).toBeNull();
    expect(streamWearerOf({ wornBy: null }, objects)).toBeNull();
  });
});
