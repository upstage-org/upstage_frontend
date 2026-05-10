import type { DocumentNode } from "graphql";
import { gql } from "@apollo/client/core";
import { apolloClient } from "../../apollo";

export { gql };

const ensureDocument = (query: string | DocumentNode): DocumentNode =>
  typeof query === "string" ? gql(query) : query;

const isMutation = (doc: DocumentNode): boolean =>
  doc.definitions.some((def) => def.kind === "OperationDefinition" && def.operation === "mutation");

interface ApolloErrorShape {
  response: { errors: ReadonlyArray<unknown> };
  request: { query: string };
}

const toLegacyError = (
  errors: ReadonlyArray<unknown>,
  document: DocumentNode,
): ApolloErrorShape => ({
  response: { errors },
  request: { query: document.loc?.source.body ?? "" },
});

/** Apollo Client rejects with ApolloError.graphQLErrors; legacy code expects response.errors. */
function rethrowAsLegacyIfApollo(err: unknown, document: DocumentNode): never {
  const gqlErrors =
    err &&
    typeof err === "object" &&
    "graphQLErrors" in err &&
    Array.isArray((err as { graphQLErrors?: unknown }).graphQLErrors) &&
    (err as { graphQLErrors: unknown[] }).graphQLErrors.length > 0
      ? (err as { graphQLErrors: ReadonlyArray<unknown> }).graphQLErrors
      : undefined;
  if (gqlErrors) {
    throw toLegacyError(gqlErrors, document);
  }
  throw err;
}

interface StudioClient {
  request: <TData = unknown, TVars extends Record<string, unknown> | undefined = undefined>(
    query: string | DocumentNode,
    variables?: TVars,
  ) => Promise<TData>;
}

/**
 * Backwards-compatible factory that mirrors the old `graphql-request`-based
 * `studioClient.request(query, variables)` API while routing every operation
 * through the singleton Apollo client (so refresh-token, auth headers, error
 * handling all live in one place).
 *
 * The `namespace` parameter is preserved for call-site compatibility but is
 * unused; Apollo points at a single `${GRAPHQL_ENDPOINT}studio_graphql` URL.
 */
export const createClient = (_namespace: string): StudioClient => ({
  async request(query, variables) {
    const document = ensureDocument(query);
    const operationIsMutation = isMutation(document);

    if (operationIsMutation) {
      try {
        const result = await apolloClient.mutate({
          mutation: document,
          variables: variables as Record<string, unknown> | undefined,
          fetchPolicy: "no-cache",
        });
        if (result.errors?.length) {
          throw toLegacyError(result.errors, document);
        }
        return result.data as never;
      } catch (err) {
        rethrowAsLegacyIfApollo(err, document);
      }
    }

    try {
      const result = await apolloClient.query({
        query: document,
        variables: variables as Record<string, unknown> | undefined,
        fetchPolicy: "no-cache",
      });
      if (result.errors?.length) {
        throw toLegacyError(result.errors, document);
      }
      return result.data as never;
    } catch (err) {
      rethrowAsLegacyIfApollo(err, document);
    }
  },
});
