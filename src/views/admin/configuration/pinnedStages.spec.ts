import { describe, expect, it } from "vitest";
import { movePinned, parsePinnedIds } from "./pinnedStages";

describe("foyer pinned stages (#1568)", () => {
  it("parses the stored JSON list and ignores junk", () => {
    expect(parsePinnedIds('[3, "7", 3]')).toEqual(["3", "7"]);
    expect(parsePinnedIds("")).toEqual([]);
    expect(parsePinnedIds(undefined)).toEqual([]);
    expect(parsePinnedIds("{not a list}")).toEqual([]);
    expect(parsePinnedIds('{"a":1}')).toEqual([]);
  });

  it("moves an id up or down and stays put at the ends", () => {
    expect(movePinned(["1", "2", "3"], "3", -1)).toEqual(["1", "3", "2"]);
    expect(movePinned(["1", "2", "3"], "1", 1)).toEqual(["2", "1", "3"]);
    expect(movePinned(["1", "2", "3"], "1", -1)).toEqual(["1", "2", "3"]);
    expect(movePinned(["1", "2", "3"], "3", 1)).toEqual(["1", "2", "3"]);
    expect(movePinned(["1"], "9", 1)).toEqual(["1"]);
  });
});
