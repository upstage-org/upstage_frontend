// Guards the exit-animation defaults: every assignment without explicit
// settings must exit as fade at the speed the slider calls medium (3s).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXIT_ANIMATION,
  DEFAULT_EXIT_SPEED,
  REMOVAL_ANIMATION_OPTIONS,
} from "./removalAnimations";

describe("exit animation defaults", () => {
  it("defaults to fade at 3000ms", () => {
    expect(DEFAULT_EXIT_ANIMATION).toBe("fade");
    expect(DEFAULT_EXIT_SPEED).toBe(3000);
  });

  it("offers the default animation as a picker option", () => {
    expect(REMOVAL_ANIMATION_OPTIONS.map((o) => o.value)).toContain(DEFAULT_EXIT_ANIMATION);
  });

  it("keeps the default speed inside the slider's 1-10s range", () => {
    const slider = 1000 / DEFAULT_EXIT_SPEED; // ExitSettings.vue mapping
    expect(slider).toBeGreaterThanOrEqual(0.1);
    expect(slider).toBeLessThanOrEqual(1);
  });
});
