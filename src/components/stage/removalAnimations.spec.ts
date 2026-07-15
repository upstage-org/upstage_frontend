// Guards the discrete exit-speed contract: the default is a valid option
// (Medium), and legacy slider durations snap to the closest option so the
// picker always has a selection.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXIT_ANIMATION,
  DEFAULT_EXIT_SPEED,
  EXIT_SPEED_OPTIONS,
  nearestExitSpeed,
} from "./removalAnimations";

describe("exit speed options", () => {
  it("defaults to fade at the Medium option", () => {
    expect(DEFAULT_EXIT_ANIMATION).toBe("fade");
    const medium = EXIT_SPEED_OPTIONS.find((o) => o.label === "Medium");
    expect(medium?.value).toBe(DEFAULT_EXIT_SPEED);
  });

  it("keeps exact option values unchanged", () => {
    for (const option of EXIT_SPEED_OPTIONS) {
      expect(nearestExitSpeed(option.value)).toBe(option.value);
    }
  });

  it("snaps legacy slider durations to the closest option", () => {
    expect(nearestExitSpeed(1000)).toBe(1000); // old default / fast end
    expect(nearestExitSpeed(1600)).toBe(1000);
    expect(nearestExitSpeed(2200)).toBe(3000);
    expect(nearestExitSpeed(4500)).toBe(3000);
    expect(nearestExitSpeed(6000)).toBe(8000);
    expect(nearestExitSpeed(10000)).toBe(8000); // old slow end
  });

  it("falls back to the default for missing or invalid speeds", () => {
    expect(nearestExitSpeed(undefined)).toBe(DEFAULT_EXIT_SPEED);
    expect(nearestExitSpeed(0)).toBe(DEFAULT_EXIT_SPEED);
    expect(nearestExitSpeed(-500)).toBe(DEFAULT_EXIT_SPEED);
    expect(nearestExitSpeed("nope")).toBe(DEFAULT_EXIT_SPEED);
  });
});
