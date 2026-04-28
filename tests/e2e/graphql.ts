/**
 * Tiny zero-dep GraphQL client for the e2e harness. We deliberately do NOT
 * pull in @apollo/client here so the harness can run in Node without the SPA's
 * polyfill chain.
 */

const ENDPOINT = process.env.E2E_GRAPHQL_ENDPOINT
  ?? "http://localhost:3001/api/studio_graphql";

export interface GqlResult<T> {
  data?: T;
  errors?: Array<{ message: string; path?: unknown }>;
}

export async function gql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
): Promise<GqlResult<T>> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `JWT ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status} from ${ENDPOINT}: ${await res.text()}`);
  }
  return (await res.json()) as GqlResult<T>;
}

export async function loginAsAdmin(): Promise<string> {
  const username = process.env.E2E_ADMIN_USERNAME ?? "admin";
  const password = process.env.E2E_ADMIN_PASSWORD ?? "12345678";
  const result = await gql<{
    login: { access_token: string; refresh_token: string; username: string };
  }>(
    `mutation Login($payload: LoginInput!) {
       login(payload: $payload) { access_token refresh_token username }
     }`,
    { payload: { username, password } },
  );
  if (result.errors?.length || !result.data?.login?.access_token) {
    throw new Error(
      `Admin login failed: ${JSON.stringify(result.errors ?? result.data)}`,
    );
  }
  return result.data.login.access_token;
}
