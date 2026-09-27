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
const login = vi.fn();
vi.mock("@services/graphql", () => ({
  userGraph: { login: (...args: unknown[]) => login(...args) },
}));
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
  login.mockReset();
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

describe("while a stage is open", () => {
  it("defers the logout when the renewal is refused: nothing cleared, no navigation", async () => {
    refreshSessionOnce.mockResolvedValue({ status: "rejected" });
    const store = useAuthStore();
    const token = tokenExpiringIn(2 * DAY_MS);
    store.setSession(token, "refresh", "performer");
    store.holdForStage();

    await vi.advanceTimersByTimeAsync(2 * DAY_MS);

    expect(hardNavigate).not.toHaveBeenCalled();
    expect(store.loggedIn).toBe(true);
    expect(store.token).toBe(token);
    expect(store.sessionEndDeferred).toBe(true);
    expect(consumeSessionExpiredNotice()).toBe(false);
  });

  it("stops asking for a renewal once it was refused", async () => {
    refreshSessionOnce.mockResolvedValue({ status: "rejected" });
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");
    store.holdForStage();

    await vi.advanceTimersByTimeAsync(3 * DAY_MS);

    expect(refreshSessionOnce).toHaveBeenCalledTimes(1);
  });

  it("completes the logout when the stage is left", async () => {
    refreshSessionOnce.mockResolvedValue({ status: "rejected" });
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");
    window.history.replaceState({}, "", "/my-stage");
    const release = store.holdForStage();
    await vi.advanceTimersByTimeAsync(2 * DAY_MS);

    release();
    release();

    expect(store.loggedIn).toBe(false);
    expect(hardNavigate).toHaveBeenCalledTimes(1);
    expect(hardNavigate).toHaveBeenCalledWith("/login?redirect=%2Fmy-stage");
    expect(consumeSessionExpiredNotice()).toBe(true);
  });

  it("sends the player to the page they were going to after logging in", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");
    store.holdForStage();
    expect(store.logout()).toBe(false);

    expect(store.finishDeferredLogout("/stages?tab=mine")).toBe(true);

    expect(hardNavigate).toHaveBeenCalledWith("/login?redirect=%2Fstages%3Ftab%3Dmine");
  });

  it("keeps the hold until the last stage view is gone", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");
    const first = store.holdForStage();
    const second = store.holdForStage();
    store.logout();

    first();
    expect(hardNavigate).not.toHaveBeenCalled();
    second();
    expect(hardNavigate).toHaveBeenCalledTimes(1);
  });

  it("completes the logout for a token that expired unnoticed (sleeping tab)", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(MINUTE_MS), "refresh");
    const release = store.holdForStage();
    vi.setSystemTime(Date.now() + DAY_MS);

    release();

    expect(hardNavigate).toHaveBeenCalledTimes(1);
  });

  it("leaves a working login alone when the stage is left", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");
    const release = store.holdForStage();

    expect(store.finishDeferredLogout("/stages")).toBe(false);
    release();

    expect(store.loggedIn).toBe(true);
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("is a working login again after logging in on the stage", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");
    const release = store.holdForStage();
    store.logout();

    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh-2");
    release();

    expect(store.sessionEndDeferred).toBe(false);
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("clears an ended login when the stage page itself goes away", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");
    store.holdForStage();
    store.logout();

    expect(store.dropEndedSession()).toBe(true);

    expect(store.loggedIn).toBe(false);
    expect(localStorage.getItem("upstage-auth")).toBeNull();
    expect(hardNavigate).not.toHaveBeenCalled();
    expect(consumeSessionExpiredNotice()).toBe(true);
  });

  it("keeps a working login when the stage page goes away", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");
    store.holdForStage();

    expect(store.dropEndedSession()).toBe(false);
    expect(store.loggedIn).toBe(true);
  });

  it("does not defer the player's own logout", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh");
    store.holdForStage();

    store.logoutToHome();

    expect(store.loggedIn).toBe(false);
    expect(hardNavigate).toHaveBeenCalledWith(`${window.location.origin}/`);
  });
});

describe("several windows on one login", () => {
  const shareFromOtherWindow = (token: string, refresh: string) => {
    localStorage.setItem(
      "upstage-auth",
      JSON.stringify({ username: "performer", token, refresh_token: refresh }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "upstage-auth",
        newValue: localStorage.getItem("upstage-auth"),
      }),
    );
  };

  it("takes over a login another window renewed", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(MINUTE_MS), "refresh", "performer");
    const renewed = tokenExpiringIn(2 * DAY_MS);

    shareFromOtherWindow(renewed, "refresh-2");

    expect(store.token).toBe(renewed);
    expect(store.refresh_token).toBe("refresh-2");
  });

  it("closes the prompt when the player logged in again in another window", async () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh", "performer");
    store.holdForStage();
    store.logout();
    const waiting = store.waitForReauth();
    const fresh = tokenExpiringIn(3 * DAY_MS);

    shareFromOtherWindow(fresh, "refresh-2");

    expect(store.sessionEndDeferred).toBe(false);
    expect(await waiting).toBe(fresh);
  });

  it("does not end the session when another window holds a working login", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(MINUTE_MS), "refresh", "performer");
    const renewed = tokenExpiringIn(2 * DAY_MS);
    // Stored by the other window, no storage event seen yet.
    localStorage.setItem(
      "upstage-auth",
      JSON.stringify({ username: "performer", token: renewed, refresh_token: "refresh-2" }),
    );

    expect(store.logout()).toBe(false);

    expect(store.token).toBe(renewed);
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("ignores an expired or older login from another window", () => {
    const store = useAuthStore();
    const ours = tokenExpiringIn(2 * DAY_MS);
    store.setSession(ours, "refresh", "performer");

    shareFromOtherWindow(tokenExpiringIn(-MINUTE_MS), "dead");
    expect(store.token).toBe(ours);

    shareFromOtherWindow(tokenExpiringIn(DAY_MS), "older");
    expect(store.token).toBe(ours);
  });

  it("does not clear a login another window renewed when this page goes away", () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh", "performer");
    store.holdForStage();
    store.logout();
    const renewed = tokenExpiringIn(3 * DAY_MS);
    localStorage.setItem(
      "upstage-auth",
      JSON.stringify({ username: "performer", token: renewed, refresh_token: "refresh-2" }),
    );

    expect(store.dropEndedSession()).toBe(false);

    expect(store.loggedIn).toBe(true);
    expect(JSON.parse(localStorage.getItem("upstage-auth") ?? "{}").token).toBe(renewed);
  });
});

describe("logging in again on the stage", () => {
  const endedOnStage = () => {
    const store = useAuthStore();
    store.setSession(tokenExpiringIn(2 * DAY_MS), "refresh", "performer");
    const release = store.holdForStage();
    store.logout();
    return { store, release };
  };

  it("puts the new tokens into the running session", async () => {
    const { store, release } = endedOnStage();
    const fresh = tokenExpiringIn(2 * DAY_MS);
    login.mockResolvedValue({
      login: { access_token: fresh, refresh_token: "refresh-2", username: "performer" },
    });

    await store.reauthenticate("secret", "captcha");

    expect(login).toHaveBeenCalledWith({
      username: "performer",
      password: "secret",
      token: "captcha",
    });
    expect(store.token).toBe(fresh);
    expect(store.refresh_token).toBe("refresh-2");
    expect(store.username).toBe("performer");
    expect(store.sessionEndDeferred).toBe(false);
    release();
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("hands the new token to the requests that were waiting", async () => {
    const { store } = endedOnStage();
    const fresh = tokenExpiringIn(2 * DAY_MS);
    login.mockResolvedValue({ login: { access_token: fresh, username: "performer" } });
    const waiting = [store.waitForReauth(), store.waitForReauth()];

    await store.reauthenticate("secret");

    expect(await Promise.all(waiting)).toEqual([fresh, fresh]);
  });

  it("renews the new token ahead of its expiry like any other", async () => {
    const { store } = endedOnStage();
    login.mockResolvedValue({
      login: { access_token: tokenExpiringIn(2 * DAY_MS), username: "performer" },
    });
    refreshSessionOnce.mockResolvedValue({ status: "refreshed", accessToken: "new" });

    await store.reauthenticate("secret");
    await vi.advanceTimersByTimeAsync(2 * DAY_MS - 4 * MINUTE_MS);

    expect(refreshSessionOnce).toHaveBeenCalledTimes(1);
  });

  it("changes nothing when the password is wrong", async () => {
    const { store } = endedOnStage();
    const before = store.token;
    login.mockRejectedValue({ response: { errors: [{ message: "Incorrect password" }] } });

    await expect(store.reauthenticate("wrong")).rejects.toThrow("Incorrect password");

    expect(store.token).toBe(before);
    expect(store.sessionEndDeferred).toBe(true);
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("refuses the tokens of another account", async () => {
    const { store } = endedOnStage();
    const before = store.token;
    login.mockResolvedValue({
      login: { access_token: tokenExpiringIn(DAY_MS), username: "someone-else" },
    });

    await expect(store.reauthenticate("secret")).rejects.toThrow();

    expect(store.token).toBe(before);
    expect(store.sessionEndDeferred).toBe(true);
  });

  it("fails the waiting requests when the player answers later", async () => {
    const { store } = endedOnStage();
    const waiting = store.waitForReauth();

    store.dismissReauth();

    expect(await waiting).toBeNull();
    expect(await store.waitForReauth()).toBeNull();
    expect(store.sessionEndDeferred).toBe(true);
  });

  it("waits again once the prompt is reopened", async () => {
    const { store } = endedOnStage();
    store.dismissReauth();
    store.requestReauth();
    const fresh = tokenExpiringIn(2 * DAY_MS);
    login.mockResolvedValue({ login: { access_token: fresh, username: "performer" } });

    const waiting = store.waitForReauth();
    await store.reauthenticate("secret");

    expect(await waiting).toBe(fresh);
  });

  it("still completes the logout on leaving when the player never logged in", () => {
    const { store, release } = endedOnStage();
    store.dismissReauth();

    release();

    expect(store.loggedIn).toBe(false);
    expect(hardNavigate).toHaveBeenCalledTimes(1);
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
