import { describe, expect, it } from "vitest";
describe("truncateText", () => {
  it("keeps short text and shortens long text by code points", async () => {
    const { truncateText } = await import("./common");
    expect(truncateText("short", 15, 10)).toBe("short");
    expect(truncateText("a".repeat(16), 15, 10)).toBe("aaaaaaaaaa...");
    // 12 emoji are 24 UTF-16 units; the cut must land between emoji.
    const emoji = "😀".repeat(12);
    expect(truncateText(emoji, 15, 10)).toBe(emoji);
    expect(truncateText(`${emoji}😀😀😀😀`, 15, 10)).toBe(`${"😀".repeat(10)}...`);
    expect(truncateText("", 15, 10)).toBe("");
  });

  it("keeps multi-code-point emoji (ZWJ families, flags) whole", async () => {
    const { truncateText } = await import("./common");
    const family = "👨‍👩‍👧‍👦";
    expect(truncateText(family.repeat(16), 15, 10)).toBe(`${family.repeat(10)}...`);
    const flags = "🇳🇿".repeat(16);
    expect(truncateText(flags, 15, 3)).toBe("🇳🇿🇳🇿🇳🇿...");
  });
});

describe("snapToDevicePixel", () => {
  it("rounds to whole device pixels for the given ratio", async () => {
    const { snapToDevicePixel } = await import("./common");
    expect(snapToDevicePixel(30.4, 1)).toBe(30);
    expect(snapToDevicePixel(30.6, 1)).toBe(31);
    // 1.25 device pixels per CSS pixel: 30.4 css px = 38 device px exactly.
    expect(snapToDevicePixel(30.4, 1.25)).toBe(30.4);
    expect(snapToDevicePixel(30.5, 1.25)).toBeCloseTo(30.4, 10);
    expect(snapToDevicePixel(30.25, 2)).toBe(30.5);
  });

  it("leaves non-finite lengths and bad ratios alone", async () => {
    const { snapToDevicePixel } = await import("./common");
    expect(snapToDevicePixel(NaN, 1)).toBeNaN();
    expect(snapToDevicePixel(10.4, 0)).toBe(10);
    expect(snapToDevicePixel(10.4, NaN)).toBe(10);
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
