import { describe, expect, it } from "vitest";
import { replayUrl } from "./replayLink";

describe("replayUrl", () => {
  it("builds encoded replay path from slug and performance id", () => {
    expect(replayUrl("my-stage", 42)).toMatch(/\/replay\/my-stage\/42$/);
  });

  it("encodes special characters in slug", () => {
    expect(replayUrl("stage/with spaces", "1")).toContain(
      encodeURIComponent("stage/with spaces"),
    );
  });
});
