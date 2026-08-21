import { describe, expect, it } from "vitest";
import { describeBuild, needsReload, parseServedBuild, type BuildInfo } from "./buildVersion";

const A: BuildInfo = { version: "2026.08.22-013314", builtAt: "2026-08-22T01:33:14.000Z" };
const B: BuildInfo = { version: "2026.08.22-020000", builtAt: "2026-08-22T02:00:00.000Z" };

describe("needsReload", () => {
  it("same build → no reload", () => {
    expect(needsReload(A, { ...A })).toBe(false);
  });
  it("different stamp → reload", () => {
    expect(needsReload(A, B)).toBe(true);
  });
  it("same stamp but newer server timestamp → reload", () => {
    expect(needsReload(A, { version: A.version, builtAt: B.builtAt })).toBe(true);
  });
  it("same stamp but older server timestamp (rollback) → reload", () => {
    expect(needsReload(B, { version: B.version, builtAt: A.builtAt })).toBe(true);
  });
  it("different stamp even with identical timestamp → reload", () => {
    expect(needsReload(A, { version: "other", builtAt: A.builtAt })).toBe(true);
  });
  it("same stamp and an unparseable/missing timestamp on either side → no reload", () => {
    expect(needsReload(A, { version: A.version, builtAt: "" })).toBe(false);
    expect(needsReload({ version: A.version, builtAt: "garbage" }, A)).toBe(false);
  });
  it("missing running or served info → never nags", () => {
    expect(needsReload(null, A)).toBe(false);
    expect(needsReload(A, null)).toBe(false);
    expect(needsReload(null, null)).toBe(false);
  });
});

describe("parseServedBuild", () => {
  it("accepts the generated shape", () => {
    expect(parseServedBuild({ version: " v1 ", builtAt: A.builtAt })).toEqual({
      version: "v1",
      builtAt: A.builtAt,
    });
  });
  it("accepts the legacy shape (version only)", () => {
    expect(parseServedBuild({ version: "2026.05.05-84a231c" })).toEqual({
      version: "2026.05.05-84a231c",
      builtAt: "",
    });
  });
  it("rejects junk", () => {
    expect(parseServedBuild(null)).toBeNull();
    expect(parseServedBuild("x")).toBeNull();
    expect(parseServedBuild({})).toBeNull();
    expect(parseServedBuild({ version: "" })).toBeNull();
    expect(parseServedBuild({ version: 3 })).toBeNull();
  });
});

describe("describeBuild", () => {
  it("includes the stamp and a human build time", () => {
    const s = describeBuild(A);
    expect(s).toContain(A.version);
    expect(s).toMatch(/built .*2026/);
  });
  it("falls back to the stamp alone without a timestamp", () => {
    expect(describeBuild({ version: "v1", builtAt: "" })).toBe("v1");
  });
});
