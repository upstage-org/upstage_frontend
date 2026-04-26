import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  removeRefreshToken,
  removeToken,
  setRefreshToken,
  setToken,
} from "@utils/auth";

/**
 * Authentication state. Mirrors the Vuex `auth` module API one-to-one so that
 * existing call sites (and the legacy Vuex shim) can be migrated incrementally.
 *
 * Persistence is handled by `pinia-plugin-persistedstate`, replacing the old
 * `vuex-persistedstate` plugin scoped to `paths: ['auth']`.
 */
export const useAuthStore = defineStore("auth", () => {
  const username = ref<string>("");
  const token = ref<string>("");
  const refreshToken = ref<string>("");

  const loggedIn = computed<boolean>(() => Boolean(token.value));
  const getToken = computed<string>(() => token.value);
  const getRefreshToken = computed<string>(() => refreshToken.value);

  const setSession = (
    accessToken: string,
    refresh: string,
    name?: string,
  ): void => {
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
  };
}, {
  persist: {
    key: "upstage-auth",
    paths: ["username", "token", "refresh_token"],
  },
});
