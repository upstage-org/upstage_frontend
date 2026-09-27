// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gql } from "@apollo/client/core";

/**
 * The Apollo error link, when a request is answered with an auth error:
 * renew the token pair and replay; if the server refuses the renewal, leave
 * for the login page without surfacing an error; if the server cannot be
 * reached, stay logged in and report a network problem.
 */

const logout = vi.fn();
const sessionEndDeferred = vi.fn();
const waitForReauth = vi.fn();
const notifyNetworkError = vi.fn();

vi.mock("config", () => ({ default: { GRAPHQL_ENDPOINT: "https://api.test/api/" } }));
vi.mock("utils/auth", () => ({
  logout: () => logout(),
  sessionEndDeferred: () => sessionEndDeferred(),
  waitForReauth: () => waitForReauth(),
  isJwtExpired: () => false,
}));
vi.mock("utils/networkResilience", async (original) => ({
  ...(await original<typeof import("utils/networkResilience")>()),
  notifyNetworkError: () => notifyNetworkError(),
}));
vi.mock("./store/pinia/auth", () => ({
  useAuthStore: () => {
    throw new Error("no store in this test: persistSession falls back to localStorage");
  },
}));

import { apolloClient, refreshSessionOnce } from "./apollo";
import { getSharedAuth, setSharedAuth } from "utils/common";

const QUERY = gql`
  query Whoami {
    whoami {
      username
    }
  }
`;

interface Call {
  operationName: string;
  authorization: string | null;
  refreshHeader: string | null;
}

let calls: Call[] = [];

function respond(handler: (call: Call) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const call: Call = {
        operationName: JSON.parse(String(init?.body)).operationName,
        authorization: headers.get("authorization"),
        refreshHeader: headers.get("x-access-token"),
      };
      calls.push(call);
      return handler(call);
    }),
  );
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// The backend answers auth failures with HTTP 200 and an `errors` array.
const expired = () =>
  json({ data: { whoami: null }, errors: [{ message: "Signature has expired" }] });
const refused = () =>
  json({ data: { refreshToken: null }, errors: [{ message: "Invalid refresh token" }] });

const settled = async (promise: Promise<unknown>, withinMs = 1800) => {
  let state = "pending";
  promise.then(
    () => (state = "resolved"),
    () => (state = "rejected"),
  );
  await new Promise((resolve) => setTimeout(resolve, withinMs));
  return state;
};

beforeEach(async () => {
  calls = [];
  logout.mockReset();
  // Not on a stage: logout() leaves for the login page.
  logout.mockReturnValue(true);
  sessionEndDeferred.mockReset();
  sessionEndDeferred.mockReturnValue(false);
  waitForReauth.mockReset();
  waitForReauth.mockResolvedValue(null);
  notifyNetworkError.mockReset();
  localStorage.clear();
  await apolloClient.clearStore();
  setSharedAuth({ token: "old-access", refresh_token: "old-refresh", username: "performer" });
});

// No de-duplication: a request left pending by an earlier test (that is what
// leaving for the login page does) must not swallow the next identical one.
const whoami = () =>
  apolloClient.query({
    query: QUERY,
    fetchPolicy: "no-cache",
    context: { queryDeduplication: false },
  });

describe("an expired access token", () => {
  it("is renewed and the request replayed with the new token", async () => {
    respond((call) => {
      if (call.operationName === "RefreshToken") {
        return json({
          data: { refreshToken: { access_token: "new-access", refresh_token: "new-refresh" } },
        });
      }
      return call.authorization === "Bearer new-access"
        ? json({ data: { whoami: { username: "performer" } } })
        : expired();
    });

    const { data } = await whoami();

    expect(data.whoami.username).toBe("performer");
    expect(calls.map((call) => call.operationName)).toEqual(["Whoami", "RefreshToken", "Whoami"]);
    expect(calls[1].refreshHeader).toBe("old-refresh");
    expect(getSharedAuth()).toMatchObject({ token: "new-access", refresh_token: "new-refresh" });
    expect(logout).not.toHaveBeenCalled();
  });

  it("leaves for the login page, without an error, when the renewal is refused", async () => {
    respond((call) => (call.operationName === "RefreshToken" ? refused() : expired()));

    const request = whoami();

    expect(await settled(request)).toBe("pending");
    expect(logout).toHaveBeenCalledTimes(1);
    expect(notifyNetworkError).not.toHaveBeenCalled();
  });

  it("ends the session once when several requests fail together", async () => {
    respond((call) => (call.operationName === "RefreshToken" ? refused() : expired()));

    const requests = [whoami(), whoami(), whoami()];
    await Promise.all(requests.map((request) => settled(request)));

    expect(calls.filter((call) => call.operationName === "RefreshToken")).toHaveLength(1);
  });

  it("keeps the session when the renewal cannot reach the server", async () => {
    respond((call) => {
      if (call.operationName === "RefreshToken") throw new TypeError("Failed to fetch");
      return expired();
    });

    await expect(whoami()).rejects.toThrow(/Network connection problem/);

    expect(logout).not.toHaveBeenCalled();
    expect(notifyNetworkError).toHaveBeenCalled();
    expect(getSharedAuth()).toMatchObject({ token: "old-access", refresh_token: "old-refresh" });
  });

  it("leaves for the login page when there is no refresh token to renew with", async () => {
    localStorage.clear();
    setSharedAuth({ token: "old-access", refresh_token: "", username: "performer" });
    respond(() => expired());

    expect(await settled(whoami())).toBe("pending");
    expect(logout).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.operationName)).toEqual(["Whoami"]);
  });
});

describe("a renewal refused because another window renewed first", () => {
  it("takes over the other window's tokens and replays the request", async () => {
    respond((call) => {
      if (call.operationName === "RefreshToken") {
        // The other window's renewal lands in the shared storage shortly after.
        setTimeout(
          () =>
            setSharedAuth({
              token: "their-access",
              refresh_token: "their-refresh",
              username: "performer",
            }),
          300,
        );
        return refused();
      }
      return call.authorization === "Bearer their-access"
        ? json({ data: { whoami: { username: "performer" } } })
        : expired();
    });

    const { data } = await whoami();

    expect(data.whoami.username).toBe("performer");
    expect(logout).not.toHaveBeenCalled();
    expect(getSharedAuth()).toMatchObject({
      token: "their-access",
      refresh_token: "their-refresh",
    });
  });
});

describe("a login that ends while a stage is open", () => {
  it("waits for the player to log in again, then replays with the new token", async () => {
    logout.mockReturnValue(false);
    let loggedInAgain: (token: string | null) => void = () => {};
    waitForReauth.mockReturnValue(new Promise((resolve) => (loggedInAgain = resolve)));
    respond((call) => {
      if (call.operationName === "RefreshToken") return refused();
      return call.authorization === "Bearer fresh-access"
        ? json({ data: { whoami: { username: "performer" } } })
        : expired();
    });

    const request = whoami();
    expect(await settled(request)).toBe("pending");

    loggedInAgain("fresh-access");
    const { data } = await request;

    expect(data.whoami.username).toBe("performer");
    expect(calls.map((call) => call.operationName)).toEqual(["Whoami", "RefreshToken", "Whoami"]);
    expect(notifyNetworkError).not.toHaveBeenCalled();
  });

  it("tells the caller the request failed when the player does not log in", async () => {
    logout.mockReturnValue(false);
    waitForReauth.mockResolvedValue(null);
    respond((call) => (call.operationName === "RefreshToken" ? refused() : expired()));

    await expect(whoami()).rejects.toThrow(/login has expired/);

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a renewal again once it was refused", async () => {
    sessionEndDeferred.mockReturnValue(true);
    waitForReauth.mockResolvedValue(null);
    respond(() => expired());

    await expect(whoami()).rejects.toThrow(/login has expired/);

    expect(calls.map((call) => call.operationName)).toEqual(["Whoami"]);
    expect(logout).not.toHaveBeenCalled();
  });
});

describe("a visitor who is not logged in", () => {
  it("gets the auth error back and is not sent anywhere", async () => {
    localStorage.clear();
    respond(() => json({ data: { whoami: null }, errors: [{ message: "Authenticated Failed" }] }));

    await expect(whoami()).rejects.toThrow();

    expect(logout).not.toHaveBeenCalled();
  });
});

describe("refreshSessionOnce", () => {
  it("reports a server error (5xx) as unavailable, not as an ended session", async () => {
    respond(() => new Response("bad gateway", { status: 502 }));
    expect(await refreshSessionOnce()).toEqual({ status: "unavailable" });
  });

  it("reports a missing token in the answer as a refusal", async () => {
    respond(() => json({ data: { refreshToken: null } }));
    expect(await refreshSessionOnce()).toEqual({ status: "rejected" });
  });
});
