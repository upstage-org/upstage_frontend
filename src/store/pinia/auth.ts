import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { message } from "ant-design-vue";
import { removeRefreshToken, removeToken, setRefreshToken, setToken } from "@utils/auth";
import { userGraph } from "@services/graphql";

/**
 * Authentication state + auth-related actions. Single source of truth
 * for auth across the SPA: `username` / `token` / `refresh_token`
 * state, `loggedIn` / `getToken` / `getRefreshToken` getters, and
 * `login` / `logout` / `fetchRefreshToken` actions. Persistence is
 * handled by `pinia-plugin-persistedstate`.
 */

interface LoginPayload {
  username: string;
  password: string;
  token?: string;
}

interface LoginResponse {
  login?: {
    access_token?: string;
    refresh_token?: string;
    username?: string;
  };
  errors?: Array<{ message?: string }>;
}

interface RefreshResponse {
  refreshToken?: { access_token?: string };
}

export const useAuthStore = defineStore(
  "auth",
  () => {
    const username = ref<string>("");
    const token = ref<string>("");
    const refreshToken = ref<string>("");

    const loggedIn = computed<boolean>(() => Boolean(token.value));
    const getToken = computed<string>(() => token.value);
    const getRefreshToken = computed<string>(() => refreshToken.value);

    const setSession = (accessToken: string, refresh: string, name?: string): void => {
      token.value = accessToken;
      refreshToken.value = refresh;
      if (name !== undefined) username.value = name;
      setToken(accessToken);
      setRefreshToken(refresh);
    };

    const clear = (): void => {
      token.value = "";
      refreshToken.value = "";
    };

    const logoutLocal = (): void => {
      clear();
      localStorage.clear();
      removeToken();
      removeRefreshToken();
    };

    /**
     * Authenticate against the studio GraphQL endpoint and persist the
     * returned tokens. Resolves with no value on success; rejects with
     * the underlying error on failure (and surfaces a user-facing toast
     * via ant-design's `message`). Returns a Promise so the LoginForm
     * component can `await login()` and react to success/failure.
     */
    const login = async (user: LoginPayload): Promise<void> => {
      try {
        const resp = (await userGraph.login(user)) as LoginResponse;
        if (resp?.login?.access_token) {
          const { access_token, refresh_token, username: name } = resp.login;
          setSession(access_token, refresh_token ?? "", name);
          return;
        }
        const msg = resp?.errors?.[0]?.message ?? "Login failed";
        message.error(msg);
        throw new Error(msg);
      } catch (err: unknown) {
        const e = err as {
          response?: { errors?: Array<{ message?: string }> };
          graphQLErrors?: Array<{ message?: string }>;
          message?: string;
        };
        const msg =
          e?.response?.errors?.[0]?.message ??
          e?.graphQLErrors?.[0]?.message ??
          (typeof e?.message === "string" ? e.message : null) ??
          "Error!";
        message.error(msg);
        throw err;
      }
    };

    /**
     * Clear local session and hard-navigate to the home page. Route
     * guards then re-evaluate from the (now-empty) auth state.
     */
    const logout = (): void => {
      logoutLocal();
      window.location.href = "/";
    };

    /**
     * Exchange the refresh token for a new access token. Used by the
     * Apollo error link on `Signature has expired` / `Authenticated
     * Failed`. Resolves with the new access token on success; on
     * failure clears the session and redirects to "/".
     */
    const fetchRefreshToken = async (): Promise<string | undefined> => {
      try {
        const response = (await userGraph.refreshUser(
          { refreshToken: refreshToken.value },
          { "X-Access-Token": refreshToken.value },
        )) as RefreshResponse;
        const newToken = response?.refreshToken?.access_token;
        if (newToken) {
          token.value = newToken;
          setToken(newToken);
        }
        return newToken;
      } catch {
        logoutLocal();
        window.location.href = "/";
        return undefined;
      }
    };

    return {
      username,
      token,
      refresh_token: refreshToken,
      loggedIn,
      getToken,
      getRefreshToken,
      setSession,
      clear,
      logoutLocal,
      login,
      logout,
      fetchRefreshToken,
    };
  },
  {
    persist: {
      key: "upstage-auth",
      pick: ["username", "token", "refresh_token"],
    },
  },
);
