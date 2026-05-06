import "./e2e-env-bootstrap";

/**
 * Tiny zero-dep GraphQL client for the e2e harness. We deliberately do NOT
 * pull in @apollo/client here so the harness can run in Node without the SPA's
 * polyfill chain.
 *
 * Resolved URLs and credentials come from `e2e-config.ts` (`loadE2eConfig`)
 * after `.env.test` loading via `e2e-env-bootstrap`.
 */

import {
  getE2eGraphQlEndpoint,
  loadE2eConfig,
} from "./e2e-config";

export { getE2eGraphQlEndpoint };

export interface GqlResult<T> {
  data?: T;
  errors?: Array<{ message: string; path?: unknown }>;
}

export async function gql<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
): Promise<GqlResult<T>> {
  const endpoint = getE2eGraphQlEndpoint();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(
      `GraphQL HTTP ${res.status} from ${endpoint}: ${await res.text()}`,
    );
  }
  return (await res.json()) as GqlResult<T>;
}

export async function loginAsAdmin(): Promise<string> {
  const { adminUsername: username, adminPassword: password } = loadE2eConfig();
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
