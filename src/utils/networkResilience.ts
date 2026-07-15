import { message } from "ant-design-vue";
import type { Operation } from "@apollo/client/core";

/**
 * Browser wordings for "the request never completed at the network layer"
 * (Chrome "Failed to fetch" / ERR_NETWORK_CHANGED, Safari "Load failed",
 * Firefox "NetworkError when attempting to fetch resource"). These are safe
 * to retry even for mutations: the request (almost always) never reached
 * the server.
 */
const TRANSIENT_NETWORK_RE =
  /failed to fetch|network[\s_]?changed|load failed|networkerror when attempting/i;

/**
 * Mutations that must never be replayed automatically: sendEmail has a
 * visible side effect (duplicate emails), and refreshToken's lifecycle is
 * managed by the errorLink's own replay machinery in apollo.ts.
 */
const NEVER_RETRY_MUTATIONS = new Set(["SendEmail", "RefreshToken", "sendEmail", "refreshToken"]);

export const QUERY_RETRY_MAX = 5;
export const MUTATION_RETRY_MAX = 3;

const isTimeoutError = (error: unknown): boolean =>
  error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");

const isMutationOperation = (operation: Operation): boolean => {
  const definition = operation.query.definitions.find((def) => def.kind === "OperationDefinition");
  return definition?.kind === "OperationDefinition" && definition.operation === "mutation";
};

/**
 * RetryLink `attempts` predicate. Queries are idempotent so any network
 * error (including a timeout) retries up to QUERY_RETRY_MAX. Mutations only
 * retry transient never-left-the-browser errors — a timed-out mutation may
 * have been processed server-side, so it must surface instead of replaying.
 */
export function shouldRetry(count: number, operation: Operation, error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (!isMutationOperation(operation)) {
    return count < QUERY_RETRY_MAX;
  }
  if (NEVER_RETRY_MUTATIONS.has(operation.operationName ?? "")) {
    return false;
  }
  if (isTimeoutError(error)) {
    return false;
  }
  return count < MUTATION_RETRY_MAX && TRANSIENT_NETWORK_RE.test(String(error));
}

/**
 * Wraps the global fetch so every request carries an overall deadline; a
 * socket left hanging by a network switch fails (and can be retried)
 * instead of stalling for the browser's multi-minute default. A signal
 * supplied by the caller still aborts as before.
 */
export const fetchWithTimeout =
  (timeoutMs: number): typeof fetch =>
  (input, init = {}) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };

export const NETWORK_ERROR_TOAST =
  "Network connection problem — retried without luck. Please check your connection and try again.";
const TOAST_KEY = "apollo-network-error";
const TOAST_THROTTLE_MS = 5_000;
let lastToastAt = -Infinity;

/**
 * Friendly replacement for the raw "[Network error]: TypeError: Failed to
 * fetch" toast. Keyed + throttled so a burst of concurrently failing
 * queries produces a single toast instead of a stack.
 */
export function notifyNetworkError(now: number = Date.now()): void {
  if (now - lastToastAt < TOAST_THROTTLE_MS) {
    return;
  }
  lastToastAt = now;
  message.error({ content: NETWORK_ERROR_TOAST, key: TOAST_KEY, duration: 5 });
}
