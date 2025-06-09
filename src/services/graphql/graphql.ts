// @ts-nocheck
import { GraphQLClient } from "graphql-request";
export { gql } from "graphql-request";
import config from "config";
import { useAuthStore } from "store/modules/auth";

export const createClient = (namespace: any) => ({
  request: async (...params: any) => {
    let response = null;
    const options = {
      headers: {},
    };
    const client = new GraphQLClient(
      `${config.GRAPHQL_ENDPOINT}${namespace}`,
      options,
    );
    const authStore = useAuthStore();
    const token = authStore.getToken;
    if (token) {
      client.setHeader("Authorization", `Bearer ${token}`);
    }
    try {
      response = await client.request(...params);
    } catch (error: any) {
      const isRefresh = error.request.query
        .trim()
        .startsWith("mutation RefreshToken");
      const refreshToken = authStore.getRefreshToken;
      if (
        !isRefresh &&
        refreshToken &&
        ["Authenticated Failed", "Signature has expired"].includes(error.response.errors[0].message)
      ) {
        const newToken = await authStore.fetchRefreshToken();
        client.setHeader("Authorization", `Bearer ${newToken}`);
        response = await client.request(...params);
      } else {
        throw error;
      }
    }
    return response;
  },
});
