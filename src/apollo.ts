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
import { message } from "ant-design-vue";
import configs from "config";
import { getSharedAuth, setSharedAuth } from "utils/common";
import {
  getAccessTokenForGraphql,
  getRefreshTokenForGraphql,
} from "utils/graphqlAuth";
import { Media } from "models/studio";
import { provideApolloClient } from "@vue/apollo-composable";
import { logout } from "utils/auth";

const REFRESHABLE_ERRORS = new Set([
  "Signature has expired",
  "Authenticated Failed",
]);
// HTTP connection to the API
const httpLink = createHttpLink({
  // You should use an absolute URL here
  uri: `${configs.GRAPHQL_ENDPOINT}studio_graphql`,
});

let refreshing = false;

const errorLink = onError(
  ({ graphQLErrors, networkError, operation, forward }) => {
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
                  "Authorization": `Bearer ${accessToken}`,
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
              "Authorization": `Bearer ${accessToken}`,
            },
          });
          return forward(operation);
        });
      }
    }
    if (networkError) {
      message.error(`[Network error]: ${networkError}`);
    }
  },
);

const authLink = setContext((request, { headers }) => {
  const token = getAccessTokenForGraphql();
  return {
    headers: {
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...headers,
    },
  };
});

// Cache implementation
export const inquiryVar = makeVar({});
export const editingMediaVar = makeVar<Media | undefined>(undefined);
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
            return editingMediaVar();
          },
        },
      },
    },
  },
});

// Create the apollo client
export const apolloClient = new ApolloClient({
  link: from([errorLink, authLink, httpLink]),
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
