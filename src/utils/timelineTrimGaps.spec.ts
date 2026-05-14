import { describe, expect, it } from "vitest";
import { compressSortedTimesMs } from "./timelineTrimGaps";

describe("compressSortedTimesMs", () => {
  it("shortens long gaps while keeping min pause", () => {
    const times = [1_000_000, 1_010_000, 1_120_000];
    expect(compressSortedTimesMs(times, 30_000)).toEqual([
      1_000_000, 1_010_000, 1_040_000,
    ]);
  });

  it("rejects negative min pause", () => {
    expect(() => compressSortedTimesMs([0, 1], -1)).toThrow();
  });
});
