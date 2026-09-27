import {
  ApolloClient,
  createHttpLink,
  InMemoryCache,
  makeVar,
  from,
  fromPromise,
  gql,
  Observable,
} from "@apollo/client/core";
import type { FetchResult, NextLink, Operation } from "@apollo/client/core";
import { setContext } from "@apollo/client/link/context";
import { onError } from "@apollo/client/link/error";
import { RetryLink } from "@apollo/client/link/retry";
import configs from "config";
import { getSharedAuth, setSharedAuth } from "utils/common";
import { fetchWithTimeout, notifyNetworkError, shouldRetry } from "utils/networkResilience";
import { getAccessTokenForGraphql, getRefreshTokenForGraphql } from "utils/graphqlAuth";

declare module "@apollo/client/core" {
  interface DefaultContext {
    /** Set on the refresh mutation itself so an auth error there cannot recurse. */
    skipAuthRefresh?: boolean;
  }
}
import { Media } from "models/studio";
import { provideApolloClient } from "@vue/apollo-composable";
import { isJwtExpired, logout, sessionEndDeferred, waitForReauth } from "utils/auth";
import { SESSION_ENDED_MESSAGE } from "utils/sessionExpiry";

export type RefreshOutcome =
  | { status: "refreshed"; accessToken: string }
  /** The server refused: the session is over. */
  | { status: "rejected" }
  /** The server could not be reached: the session may well still be valid. */
  | { status: "unavailable" };

const REFRESHABLE_ERRORS = new Set(["Signature has expired", "Authenticated Failed"]);
// Overall per-request deadline. Generous on purpose: slow networks should
// finish, only truly hung sockets (e.g. killed by a network switch with no
// RST) get aborted — and the abort lets RetryLink replay queries.
const REQUEST_TIMEOUT_MS = 60_000;
// HTTP connection to the API
const httpLink = createHttpLink({
  // You should use an absolute URL here
  uri: `${configs.GRAPHQL_ENDPOINT}studio_graphql`,
  fetch: fetchWithTimeout(REQUEST_TIMEOUT_MS),
});

// Transparent retries for transient network failures (wifi↔cellular
// switches, bursty slowness). Only fires on network errors — GraphQL
// errors, including the auth-refresh ones handled by errorLink below,
// pass straight through. Policy lives in utils/networkResilience.
const retryLink = new RetryLink({
  delay: { initial: 400, max: 8_000, jitter: true },
  attempts: shouldRetry,
});

const REFRESH_TOKEN_MUTATION = gql`
  mutation RefreshToken {
    refreshToken {
      access_token
      refresh_token
    }
  }
`;

/**
 * Persist a rotated token pair. Goes through the Pinia auth store when it is
 * available (so its refs, cookies and the persisted-state plugin all agree);
 * falls back to the raw localStorage blob otherwise (e.g. unit tests).
 * Imported lazily to keep the `store → graphql → apollo → store` cycle open.
 */
async function persistSession(accessToken: string, refreshToken: string): Promise<void> {
  try {
    const { useAuthStore } = await import("./store/pinia/auth");
    useAuthStore().setSession(accessToken, refreshToken);
    return;
  } catch {
    /* fall through */
  }
  setSharedAuth({
    token: accessToken,
    refresh_token: refreshToken,
    username: getSharedAuth()?.username ?? "",
  });
}

/**
 * One refresh at a time. Every request that hits an auth error while a
 * refresh is in flight awaits the SAME promise, then replays with the new
 * token. (The previous flag + 500 ms polling loop could get stuck forever
 * when the refresh response carried no token, and it wrote the OLD refresh
 * token back even though the backend rotates and deletes it.)
 */
let refreshPromise: Promise<RefreshOutcome> | null = null;

/**
 * A refresh that failed because the server said no (a GraphQL error, or an
 * HTTP 4xx, which is how the backend answers a refused refresh) as opposed
 * to one that never got an answer (offline, timeout, 5xx).
 */
function refusedByServer(error: unknown): boolean {
  const failure = error as {
    graphQLErrors?: readonly unknown[];
    networkError?: { statusCode?: number; result?: { errors?: unknown[] } } | null;
  };
  if (failure?.graphQLErrors?.length) return true;
  const network = failure?.networkError;
  if (network?.result?.errors?.length) return true;
  const status = network?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500;
}

async function doRefresh(): Promise<RefreshOutcome> {
  const currentRefresh = getRefreshTokenForGraphql();
  if (!currentRefresh) return { status: "rejected" };
  try {
    const { data } = await apolloClient.mutate<{
      refreshToken?: { access_token?: string; refresh_token?: string } | null;
    }>({
      mutation: REFRESH_TOKEN_MUTATION,
      context: { headers: { "X-Access-Token": currentRefresh }, skipAuthRefresh: true },
      fetchPolicy: "no-cache",
    });
    const accessToken = data?.refreshToken?.access_token;
    if (!accessToken) return (await renewedElsewhere(currentRefresh)) ?? { status: "rejected" };
    await persistSession(accessToken, data?.refreshToken?.refresh_token ?? currentRefresh);
    return { status: "refreshed", accessToken };
  } catch (error) {
    if (!refusedByServer(error)) return { status: "unavailable" };
    return (await renewedElsewhere(currentRefresh)) ?? { status: "rejected" };
  }
}

// How long a refused renewal waits for another window's renewal to land.
const RENEWED_ELSEWHERE_GRACE_MS = 1500;
const RENEWED_ELSEWHERE_POLL_MS = 100;

/**
 * The backend rotates the refresh token on every use. Two windows of one
 * player (stage and popped-out chat, say) renew at the same moment, five
 * minutes before the same expiry, so one of them is refused with a token the
 * other has just used up. That is not the end of the login: the other
 * window's new tokens are in the shared storage (or are about to be).
 */
async function renewedElsewhere(sentRefresh: string): Promise<RefreshOutcome | null> {
  const deadline = Date.now() + RENEWED_ELSEWHERE_GRACE_MS;
  for (;;) {
    const shared = getSharedAuth();
    if (
      shared?.token &&
      shared.refresh_token &&
      shared.refresh_token !== sentRefresh &&
      !isJwtExpired(shared.token)
    ) {
      await persistSession(shared.token, shared.refresh_token);
      return { status: "refreshed", accessToken: shared.token };
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, RENEWED_ELSEWHERE_POLL_MS));
  }
}

export function refreshSessionOnce(): Promise<RefreshOutcome> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function refreshAccessTokenOnce(): Promise<string | null> {
  const outcome = await refreshSessionOnce();
  return outcome.status === "refreshed" ? outcome.accessToken : null;
}

/**
 * The session is over: leave for the login page. The operation that found
 * out neither completes nor fails, so the page being left does not flash an
 * error for a request the user never sees the end of.
 */
function leaveForLogin(
  operation: Operation,
  forward: NextLink,
): Observable<FetchResult> | Observable<never> {
  if (logout()) return new Observable<never>(() => {});
  // A stage is open: the player stays where they are.
  return replayAfterReauth(operation, forward);
}

/**
 * The login ended while a stage is open. The player is being asked to log
 * in again there; the request waits for that and is then sent again with
 * the new token. If they decline, the caller hears that it failed.
 */
function replayAfterReauth(operation: Operation, forward: NextLink): Observable<FetchResult> {
  return fromPromise(waitForReauth()).flatMap((accessToken) => {
    if (!accessToken) return sessionEndedError();
    operation.setContext({
      headers: { ...operation.getContext().headers, Authorization: `Bearer ${accessToken}` },
    });
    return forward(operation);
  });
}

function sessionEndedError(): Observable<never> {
  return new Observable<never>((observer) => {
    observer.error(new Error(SESSION_ENDED_MESSAGE));
  });
}

const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
  if (graphQLErrors) {
    const needsRefresh = graphQLErrors.some((err) => REFRESHABLE_ERRORS.has(err.message));
    if (needsRefresh && !operation.getContext().skipAuthRefresh) {
      if (sessionEndDeferred()) {
        // Already refused once; asking for a renewal again cannot succeed.
        return replayAfterReauth(operation, forward);
      }
      if (getRefreshTokenForGraphql()) {
        return fromPromise(refreshSessionOnce()).flatMap((outcome) => {
          if (outcome.status === "rejected") {
            return leaveForLogin(operation, forward);
          }
          if (outcome.status === "unavailable") {
            // Not an expiry: the user stays logged in and can retry.
            notifyNetworkError();
            return new Observable<never>((observer) => {
              observer.error(new Error("Network connection problem — please try again."));
            });
          }
          operation.setContext({
            headers: {
              ...operation.getContext().headers,
              Authorization: `Bearer ${outcome.accessToken}`,
            },
          });
          return forward(operation);
        });
      }
      if (getAccessTokenForGraphql()) {
        // A login the server no longer accepts, and nothing to renew it with.
        return leaveForLogin(operation, forward);
      }
      // Not logged in at all: the caller gets the error as usual.
    }
  }
  if (networkError) {
    // Only reached after retryLink has exhausted its attempts.
    notifyNetworkError();
  }
});

const authLink = setContext((request, { headers }) => {
  const token = getAccessTokenForGraphql();
  return {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  };
});

// Cache implementation
export const inquiryVar = makeVar({});
export const editingMediaVar = makeVar<Media | undefined>(undefined);
/**
 * Opens the StreamFeedForm modal (RTMP stream feeds — see /root/streaming2):
 * `{mode:"create"}` for a new feed, `{mode:"info", media}` to show the
 * ingest panel of an existing stream asset. `undefined` = closed.
 */
export const streamFeedVar = makeVar<
  { mode: "create" } | { mode: "info"; media: Media } | undefined
>(undefined);
const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        inquiry: {
          read() {
            return inquiryVar();
          },
        },
        editingMedia: {
          read() {
            // Same `?? null` contract as streamFeed below: undefined would make
            // Apollo emit `{}` and vue-apollo would keep the stale media in
            // consumers' results (Dropzone could mistake an upload for a file
            // replacement after the edit form closed).
            return editingMediaVar() ?? null;
          },
        },
        streamFeed: {
          read() {
            // `?? null` matters: a read returning undefined makes Apollo emit
            // an empty `{}` result, which @vue/apollo-composable interprets as
            // "keep the previous result" — so the StreamFeedForm modal could
            // never observe the var being cleared and stayed open forever.
            return streamFeedVar() ?? null;
          },
        },
      },
    },
  },
});

// Create the apollo client
export const apolloClient = new ApolloClient({
  // retryLink sits below errorLink (so the network-error toast fires once,
  // after retries are exhausted) and above authLink (so each retry re-runs
  // setContext and picks up a token refreshed in the meantime).
  link: from([errorLink, retryLink, authLink, httpLink]),
  cache,
});

/**
 * Wires the singleton Apollo client into `@vue/apollo-composable` so that
 * components can call `useQuery`/`useMutation` without manually providing it.
 *
 * Call this once during app bootstrap (see `main.ts`) BEFORE the router
 * touches any composable that depends on the client.
 */
export const installApolloClient = (): void => {
  provideApolloClient(apolloClient);
};
