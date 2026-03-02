import {
  ApolloClient,
  InMemoryCache,
  makeVar,
  ApolloLink,
  HttpLink,
  type ApolloClientOptions,
} from "@apollo/client";
import { setContext } from "@apollo/client/link/context";
import { ErrorLink } from "@apollo/client/link/error";
import { CombinedGraphQLErrors, ServerError } from "@apollo/client/errors";
import { from, type Observable } from "rxjs";
import { map, filter, mergeMap } from "rxjs";
import { message } from "ant-design-vue";
import configs from "config";
import { getSharedAuth, setSharedAuth } from "utils/common";
import gql from "graphql-tag";
import { Media } from "models/studio";
import { logout } from "utils/auth";
// HTTP connection to the API
const httpLink = new HttpLink({
  // You should use an absolute URL here
  uri: `${configs.GRAPHQL_ENDPOINT}studio_graphql`,
});

let refreshing = false;

// Declare apolloClient first to avoid circular reference
let apolloClient: ApolloClient;

const errorLink: ErrorLink = new ErrorLink(({ error, operation, forward }): Observable<any> | void => {
  if (CombinedGraphQLErrors.is(error)) {
    const sharedAuth = getSharedAuth();
    if (!sharedAuth) return;
    
    for (let err of error.errors) {
      const refreshToken = sharedAuth.refresh_token;

      if (err.message === "Signature has expired" && refreshToken) {
        if (!refreshing) {
          refreshing = true;
          // Convert Promise to Observable using RxJS from
          // @ts-ignore - apolloClient is assigned before use
          return from(
            apolloClient!
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
                throw new Error("Token refresh failed");
              })
          ).pipe(
            map((result: any) => {
              const accessToken = result?.data?.refreshToken?.access_token;
              if (accessToken) {
                refreshing = false;
                setSharedAuth({
                  token: accessToken,
                  refresh_token: refreshToken ?? "",
                  username: sharedAuth.username ?? "",
                });
                // modify the operation context with a new token
                const context = operation.getContext();
                operation.setContext({
                  ...context,
                  headers: {
                    ...context.headers,
                    "Authorization": `Bearer ${accessToken}`,
                  },
                });
                return accessToken;
              } else {
                refreshing = false;
                throw new Error("No access token in response");
              }
            }),
            filter((accessToken: any) => Boolean(accessToken)),
            mergeMap(() => forward(operation))
          );
        } else {
          // Wait for the ongoing refresh to complete, then retry
          return from(
            new Promise<string>((resolve) => {
              const checkRefresh = () => {
                if (!refreshing) {
                  const accessToken = getSharedAuth()?.token;
                  if (accessToken) {
                    resolve(accessToken);
                  } else {
                    resolve("");
                  }
                } else {
                  setTimeout(checkRefresh, 500);
                }
              };
              checkRefresh();
            })
          ).pipe(
            mergeMap((accessToken: any) => {
              if (accessToken) {
                const context = operation.getContext();
                operation.setContext({
                  ...context,
                  headers: {
                    ...context.headers,
                    "Authorization": `Bearer ${accessToken}`,
                  },
                });
                return forward(operation);
              }
              return forward(operation);
            })
          );
        }
      }
    }
  }
  if (ServerError.is(error)) {
    message.error(`[Network error]: ${error.message}`);
  }
});

const authLink = setContext((_, { headers }) => {
  // get the authentication token from local storage if it exists
  const auth = getSharedAuth();
  // return the headers to the context so httpLink can read them
  return {
    headers: {
      ...headers,
      "Authorization": `Bearer ${auth?.token}`,
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
apolloClient = new ApolloClient({
  link: ApolloLink.from([errorLink, authLink, httpLink]),
  cache,
});

export { apolloClient };
