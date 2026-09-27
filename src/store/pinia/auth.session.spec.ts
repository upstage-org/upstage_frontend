// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * How a login ends. The token pair is renewed ahead of its expiry; when the
 * server refuses the renewal the user is sent to the login page exactly
 * once, with a notice and the way back; when the server merely could not be
 * reached the user stays logged in.
 */

const refreshSessionOnce = vi.fn();
const hardNavigate = vi.fn();

vi.mock("../../apollo", () => ({ refreshSessionOnce: () => refreshSessionOnce() }));
vi.mock("@services/graphql", () => ({ userGraph: { login: vi.fn() } }));
vi.mock("@utils/sessionExpiry", async (original) => ({
  ...(await original<typeof import("@utils/sessionExpiry")>()),
  hardNavigate: (url: string) => hardNavigate(url),
}));

import { useAuthStore } from "./auth";
import { consumeSessionExpiredNotice } from "@utils/sessionExpiry";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function tokenExpiringIn(ms: number): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const exp = Math.floor((Date.now() + ms) / 1000);
  return `${encode({ alg: "HS256" })}.${encode({ user_id: 1, exp })}.signature`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T00:00:00Z"));
  setActivePinia(createPinia());
  localStorage.clear();
  sessionStorage.clear();
  refreshSessionOnce.mockReset();
  hardNavigate.mockReset();
  window.history.replaceState({}, "", "/stages?tab=mine");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("renewal ahead of the expiry", () => {
  it("renews a 2-day token five minutes before it expires", async () => {
    refreshSessionOnce.mockResolvedValue({ status: "refreshed", accessToken: "new" });
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");

    await vi.advanceTimersByTimeAsync(2 * DAY_MS - 5 * MINUTE_MS - 1000);
    expect(refreshSessionOnce).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(refreshSessionOnce).toHaveBeenCalledTimes(1);
  });

  it("does not renew a 30-day token right away (timer overflow)", async () => {
    refreshSessionOnce.mockResolvedValue({ status: "refreshed", accessToken: "new" });
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(30 * DAY_MS), "refresh");

    await vi.advanceTimersByTimeAsync(29 * DAY_MS);
    expect(refreshSessionOnce).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(refreshSessionOnce).toHaveBeenCalledTimes(1);
  });
});

describe("when the renewal is refused", () => {
  it("clears the session and goes to the login page, remembering the page", async () => {
    refreshSessionOnce.mockResolvedValue({ status: "rejected" });
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh", "performer");

    await store.fetchRefreshToken();

    expect(store.loggedIn).toBe(false);
    expect(store.refresh_token).toBe("");
    expect(hardNavigate).toHaveBeenCalledTimes(1);
    expect(hardNavigate).toHaveBeenCalledWith("/login?redirect=%2Fstages%3Ftab%3Dmine");
    expect(consumeSessionExpiredNotice()).toBe(true);
  });

  it("navigates once however many requests report the ended session", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");

    store.logout();
    store.logout();
    store.logout();

    expect(hardNavigate).toHaveBeenCalledTimes(1);
  });
});

describe("when the server cannot be reached", () => {
  it("keeps the user logged in and tries again shortly", async () => {
    refreshSessionOnce
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockResolvedValueOnce({ status: "refreshed", accessToken: "new" });
    const store = useAuthStore();
    const token = tokenExpiringIn(2 * DAY_MS);
    store.setSession(token, "refresh");

    await store.fetchRefreshToken();

    expect(store.token).toBe(token);
    expect(store.loggedIn).toBe(true);
    expect(hardNavigate).not.toHaveBeenCalled();
    expect(consumeSessionExpiredNotice()).toBe(false);

    await vi.advanceTimersByTimeAsync(30 * 1000);
    expect(refreshSessionOnce).toHaveBeenCalledTimes(2);
    expect(hardNavigate).not.toHaveBeenCalled();
  });
});

describe("an explicit logout", () => {
  it("goes to the home page and leaves no expiry notice", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");

    store.logoutToHome();

    expect(store.loggedIn).toBe(false);
    expect(hardNavigate).toHaveBeenCalledWith(`${window.location.origin}/`);
    expect(consumeSessionExpiredNotice()).toBe(false);
  });
});
