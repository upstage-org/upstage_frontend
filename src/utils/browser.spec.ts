import { describe, expect, it, vi, afterEach } from "vitest";
import { isIOS, isSafari, isWebKit } from "./browser";
import { coerceNumber } from "./common";

const originalNavigator = globalThis.navigator;

function mockNavigator(partial: Partial<Navigator> & { userAgent?: string; platform?: string }) {
  Object.defineProperty(globalThis, "navigator", {
    value: { ...originalNavigator, maxTouchPoints: 0, ...partial },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
});

describe("isIOS", () => {
  it("detects iPhone UA", () => {
    mockNavigator({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
    expect(isIOS()).toBe(true);
  });

  it("detects iPadOS MacIntel spoof", () => {
    mockNavigator({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 5 });
    expect(isIOS()).toBe(true);
  });

  it("returns false on desktop Mac", () => {
    mockNavigator({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)", platform: "MacIntel", maxTouchPoints: 0 });
    expect(isIOS()).toBe(false);
  });
});

describe("isSafari", () => {
  it("detects desktop Safari", () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    });
    expect(isSafari()).toBe(true);
  });

  it("excludes desktop Chrome", () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    expect(isSafari()).toBe(false);
  });
});

describe("isWebKit", () => {
  it("is true on iOS regardless of browser brand", () => {
    mockNavigator({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) CriOS/120.0.0.0" });
    expect(isWebKit()).toBe(true);
  });
});

describe("coerceNumber", () => {
  it("parses comma decimals", () => {
    expect(coerceNumber("1,5", { step: 0.5 })).toBe(1.5);
  });

  it("returns null for empty input", () => {
    expect(coerceNumber("")).toBeNull();
  });
});
