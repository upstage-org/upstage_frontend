// Guards the exit-animation defaults: every assignment without explicit
// settings must exit as fade at the slider's middle speed (~1.8s).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXIT_ANIMATION,
  DEFAULT_EXIT_SPEED,
  REMOVAL_ANIMATION_OPTIONS,
} from "./removalAnimations";

describe("exit animation defaults", () => {
  it("defaults to fade at the slider midpoint", () => {
    expect(DEFAULT_EXIT_ANIMATION).toBe("fade");
    // Slider midpoint: (0.1 + 1) / 2 = 0.55 → round(1000 / 0.55) ms.
    expect(DEFAULT_EXIT_SPEED).toBe(1818);
  });

  it("offers the default animation as a picker option", () => {
    expect(REMOVAL_ANIMATION_OPTIONS.map((o) => o.value)).toContain(DEFAULT_EXIT_ANIMATION);
  });

  it("lands the default speed on the middle of the slider", () => {
    const slider = 1000 / DEFAULT_EXIT_SPEED; // ExitSettings.vue mapping
    expect(slider).toBeCloseTo((0.1 + 1) / 2, 3);
  });
});
