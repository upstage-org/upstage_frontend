import {
  ApolloClient,
  createHttpLink,
  InMemoryCache,
  makeVar,
  from,
  fromPromise,
  gql,
} from "@apollo/client/core";
import { setContext } from "@apollo/client/link/context";
import { onError } from "@apollo/client/link/error";
import { RetryLink } from "@apollo/client/link/retry";
import { message } from "ant-design-vue";
import configs from "config";
import { getSharedAuth, setSharedAuth } from "utils/common";
import { fetchWithTimeout, notifyNetworkError, shouldRetry } from "utils/networkResilience";
import { getAccessTokenForGraphql, getRefreshTokenForGraphql } from "utils/graphqlAuth";
import { Media } from "models/studio";
import { provideApolloClient } from "@vue/apollo-composable";
import { logout } from "utils/auth";

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

let refreshing = false;

const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
  if (graphQLErrors) {
    const sharedAuth = getSharedAuth();
    const username = sharedAuth?.username ?? "";
    for (const err of graphQLErrors) {
      if (!REFRESHABLE_ERRORS.has(err.message)) {
        continue;
      }
      const refreshToken = getRefreshTokenForGraphql();
      if (!refreshToken) {
        return;
      }

      if (!refreshing) {
        refreshing = true;
        return fromPromise(
          apolloClient
            .mutate({
              mutation: gql`
                mutation {
                  refreshToken {
                    access_token
                    refresh_token
                  }
                }
              `,
              context: {
                headers: {
                  "X-Access-Token": refreshToken,
                },
              },
              variables: {
                refreshToken,
              },
            })
            .catch(() => {
              refreshing = false;
              logout();
              message.error(
                `Token expired, could not refresh your access token. Please login again!`,
              );
              return;
            }),
        )
          .map((value) => value?.data.refreshToken.access_token)
          .filter((value) => Boolean(value))
          .flatMap((accessToken) => {
            refreshing = false;
            setSharedAuth({
              token: accessToken,
              refresh_token: refreshToken ?? "",
              username,
            });
            operation.setContext({
              headers: {
                ...operation.getContext().headers,
                Authorization: `Bearer ${accessToken}`,
              },
            });
            return forward(operation);
          });
      }
      return fromPromise(
        new Promise<string | undefined>((resolve) => {
          const loop = () => {
            if (!refreshing) {
              resolve(getAccessTokenForGraphql());
            } else {
              setTimeout(loop, 500);
            }
          };
          loop();
        }),
      ).flatMap((accessToken) => {
        if (!accessToken) {
          return forward(operation);
        }
        operation.setContext({
          headers: {
            ...operation.getContext().headers,
            Authorization: `Bearer ${accessToken}`,
          },
        });
        return forward(operation);
      });
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

installApolloClient();
