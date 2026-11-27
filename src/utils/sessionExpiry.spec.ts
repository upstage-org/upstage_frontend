// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeSessionExpiredNotice,
  loginUrlFor,
  markSessionExpired,
  MAX_TIMER_DELAY_MS,
} from "./sessionExpiry";

beforeEach(() => {
  sessionStorage.clear();
});

describe("session-expired notice", () => {
  it("is shown once, on the first read after the session ended", () => {
    expect(consumeSessionExpiredNotice()).toBe(false);
    markSessionExpired();
    expect(consumeSessionExpiredNotice()).toBe(true);
    expect(consumeSessionExpiredNotice()).toBe(false);
  });
});

describe("loginUrlFor", () => {
  it("remembers the page the user was on", () => {
    expect(loginUrlFor("/stages")).toBe("/login?redirect=%2Fstages");
    expect(loginUrlFor("/media?page=2&q=a b")).toBe(
      "/login?redirect=%2Fmedia%3Fpage%3D2%26q%3Da%20b",
    );
  });

  it("does not point the login page back at itself or at the home page", () => {
    expect(loginUrlFor("/")).toBe("/login");
    expect(loginUrlFor("")).toBe("/login");
    expect(loginUrlFor(undefined)).toBe("/login");
    expect(loginUrlFor("/login")).toBe("/login");
    expect(loginUrlFor("/login?redirect=%2Fstages")).toBe("/login");
  });
});

describe("MAX_TIMER_DELAY_MS", () => {
  it("is the 32-bit limit of setTimeout, below a 30-day token lifetime", () => {
    expect(MAX_TIMER_DELAY_MS).toBe(2_147_483_647);
    expect(MAX_TIMER_DELAY_MS).toBeLessThan(30 * 24 * 60 * 60 * 1000);
  });
});
