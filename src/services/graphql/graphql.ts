// @ts-nocheck
import { GraphQLClient, RequestDocument, Variables } from "graphql-request";
export { gql } from "graphql-request";
import config from "config";
import { useAuthStore } from "store/modules/auth";

interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{
      line: number;
      column: number;
    }>;
    path?: string[];
  }>;
}

interface GraphQLClientOptions {
  headers?: Record<string, string>;
}

export const createClient = (namespace: string) => ({
  request: async <T = any, V = Variables>(
    document: RequestDocument,
    variables?: V,
    options?: GraphQLClientOptions
  ): Promise<T> => {
    let response: GraphQLResponse<T> | null = null;
    const clientOptions: GraphQLClientOptions = {
      headers: {},
      ...options,
    };

    const client = new GraphQLClient(
      `${config.GRAPHQL_ENDPOINT}${namespace}`,
      clientOptions
    );

    const authStore = useAuthStore();
    const token = authStore.getToken;

    if (token) {
      client.setHeader("Authorization", `Bearer ${token}`);
    }

    try {
      response = await client.request<T, V>(document, variables);
      return response as T;
    } catch (error: any) {
      const isRefresh = error.request?.query?.trim().startsWith("mutation RefreshToken");
      const refreshToken = authStore.getRefreshToken;

      if (
        !isRefresh &&
        refreshToken &&
        error.response?.errors?.[0]?.message &&
        ["Authenticated Failed", "Signature has expired"].includes(
          error.response.errors[0].message
        )
      ) {
        const newToken = await authStore.fetchRefreshToken();
        client.setHeader("Authorization", `Bearer ${newToken}`);
        response = await client.request<T, V>(document, variables);
        return response as T;
      }
      throw error;
    }
  },
});
