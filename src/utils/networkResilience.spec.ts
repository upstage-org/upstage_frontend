import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { gql, ApolloLink, Observable, execute } from "@apollo/client/core";
import type { Operation } from "@apollo/client/core";
import { RetryLink } from "@apollo/client/link/retry";
import {
  shouldRetry,
  fetchWithTimeout,
  notifyNetworkError,
  QUERY_RETRY_MAX,
  MUTATION_RETRY_MAX,
  NETWORK_ERROR_TOAST,
} from "./networkResilience";

vi.mock("ant-design-vue", () => ({
  message: { error: vi.fn() },
}));

import { message } from "ant-design-vue";

const QUERY_DOC = gql`
  query ListStages {
    stageList {
      totalCount
    }
  }
`;
const MUTATION_DOC = gql`
  mutation SaveMedia($input: MediaInput!) {
    saveMedia(input: $input) {
      id
    }
  }
`;
const SEND_EMAIL_DOC = gql`
  mutation SendEmail($to: String!) {
    sendEmail(to: $to) {
      ok
    }
  }
`;

function makeOperation(query: any, operationName: string): Operation {
  return { query, operationName } as unknown as Operation;
}

const failedToFetch = new TypeError("Failed to fetch");
const timeoutError = new DOMException("signal timed out", "TimeoutError");

describe("shouldRetry", () => {
  it("retries queries on any network error up to the cap", () => {
    const op = makeOperation(QUERY_DOC, "ListStages");
    for (let count = 1; count < QUERY_RETRY_MAX; count++) {
      expect(shouldRetry(count, op, failedToFetch)).toBe(true);
    }
    expect(shouldRetry(QUERY_RETRY_MAX, op, failedToFetch)).toBe(false);
  });

  it("retries queries on timeout aborts", () => {
    const op = makeOperation(QUERY_DOC, "ListStages");
    expect(shouldRetry(1, op, timeoutError)).toBe(true);
  });

  it("never retries without an error", () => {
    const op = makeOperation(QUERY_DOC, "ListStages");
    expect(shouldRetry(1, op, undefined)).toBe(false);
  });

  it("retries mutations on transient never-left-the-browser errors, up to the mutation cap", () => {
    const op = makeOperation(MUTATION_DOC, "SaveMedia");
    for (let count = 1; count < MUTATION_RETRY_MAX; count++) {
      expect(shouldRetry(count, op, failedToFetch)).toBe(true);
    }
    expect(shouldRetry(MUTATION_RETRY_MAX, op, failedToFetch)).toBe(false);
  });

  it("recognizes Safari and Firefox transient wordings for mutations", () => {
    const op = makeOperation(MUTATION_DOC, "SaveMedia");
    expect(shouldRetry(1, op, new TypeError("Load failed"))).toBe(true);
    expect(
      shouldRetry(1, op, new TypeError("NetworkError when attempting to fetch resource.")),
    ).toBe(true);
    expect(shouldRetry(1, op, new TypeError("net::ERR_NETWORK_CHANGED"))).toBe(true);
  });

  it("does not retry mutations on timeouts (server may have processed them)", () => {
    const op = makeOperation(MUTATION_DOC, "SaveMedia");
    expect(shouldRetry(1, op, timeoutError)).toBe(false);
  });

  it("does not retry mutations on non-transient errors", () => {
    const op = makeOperation(MUTATION_DOC, "SaveMedia");
    expect(shouldRetry(1, op, new Error("Response not successful: Received status code 500"))).toBe(
      false,
    );
  });

  it("never retries side-effect mutations", () => {
    const op = makeOperation(SEND_EMAIL_DOC, "SendEmail");
    expect(shouldRetry(1, op, failedToFetch)).toBe(false);
  });
});

describe("fetchWithTimeout", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("always attaches an abort signal", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    globalThis.fetch = spy;
    await fetchWithTimeout(5_000)("http://example.test/graphql", { method: "POST" });
    expect(spy).toHaveBeenCalledOnce();
    const init = spy.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.method).toBe("POST");
  });

  it("keeps a caller-supplied signal effective", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("{}"));
    globalThis.fetch = spy;
    const controller = new AbortController();
    controller.abort();
    await fetchWithTimeout(5_000)("http://example.test/graphql", { signal: controller.signal });
    const signal: AbortSignal = spy.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(true);
  });
});

describe("RetryLink wiring (as configured in apollo.ts)", () => {
  function attemptCounter() {
    let attempts = 0;
    const terminal = new ApolloLink(
      () =>
        new Observable((observer) => {
          attempts += 1;
          observer.error(new TypeError("Failed to fetch"));
        }),
    );
    return { terminal, count: () => attempts };
  }

  function runToError(link: ApolloLink, query: any): Promise<void> {
    return new Promise((resolve) => {
      execute(link, { query }).subscribe({ error: () => resolve() });
    });
  }

  function makeRetryLink() {
    return new RetryLink({
      delay: { initial: 1, max: 5, jitter: false },
      attempts: shouldRetry,
    });
  }

  it("attempts a query QUERY_RETRY_MAX times before surfacing the error", async () => {
    const { terminal, count } = attemptCounter();
    await runToError(makeRetryLink().concat(terminal), QUERY_DOC);
    expect(count()).toBe(QUERY_RETRY_MAX);
  });

  it("attempts a transiently-failing mutation MUTATION_RETRY_MAX times", async () => {
    const { terminal, count } = attemptCounter();
    await runToError(makeRetryLink().concat(terminal), MUTATION_DOC);
    expect(count()).toBe(MUTATION_RETRY_MAX);
  });

  it("never replays a side-effect mutation", async () => {
    const { terminal, count } = attemptCounter();
    await runToError(makeRetryLink().concat(terminal), SEND_EMAIL_DOC);
    expect(count()).toBe(1);
  });
});

describe("notifyNetworkError", () => {
  beforeEach(() => {
    vi.mocked(message.error).mockClear();
  });

  it("throttles bursts into a single keyed toast", () => {
    const base = 1_000_000;
    notifyNetworkError(base);
    notifyNetworkError(base + 100);
    notifyNetworkError(base + 4_999);
    expect(message.error).toHaveBeenCalledOnce();
    expect(message.error).toHaveBeenCalledWith({
      content: NETWORK_ERROR_TOAST,
      key: "apollo-network-error",
      duration: 5,
    });
  });

  it("toasts again once the throttle window has passed", () => {
    const base = 2_000_000;
    notifyNetworkError(base);
    notifyNetworkError(base + 5_001);
    expect(message.error).toHaveBeenCalledTimes(2);
  });
});
