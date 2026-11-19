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
});
