// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// composable.ts pulls in the app config and the Pinia stage store at module
// scope; neither is needed to test the pure placeholder helper, so stub them
// to keep the import cheap and env-independent.
vi.mock("config", () => ({ default: {} }));
vi.mock("@stores/pinia/stage", () => ({ useStageStore: () => ({}) }));

import { isPlaceholderStageUrl } from "./composable";

/**
 * Regression: the stage-URL "not loaded yet" check must only match the
 * empty placeholder. A previous version also matched the literal string
 * "demo", which meant the real Demo Stage (fileLocation === "demo") was
 * treated as never-loaded — its Jitsi conference never started, so every
 * jitsi tile buffered forever and the self-preview never joined.
 */
describe("isPlaceholderStageUrl", () => {
  it("treats null/undefined/empty as placeholder (stage not loaded)", () => {
    expect(isPlaceholderStageUrl(null)).toBe(true);
    expect(isPlaceholderStageUrl(undefined)).toBe(true);
    expect(isPlaceholderStageUrl("")).toBe(true);
  });

  it('treats the real Demo Stage slug "demo" as a loaded stage', () => {
    expect(isPlaceholderStageUrl("demo")).toBe(false);
  });

  it("treats ordinary stage slugs as loaded", () => {
    expect(isPlaceholderStageUrl("testing2026")).toBe(false);
    expect(isPlaceholderStageUrl("testing2")).toBe(false);
  });
});
