import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { message } from "ant-design-vue";
import {
  decodeJwtExp,
  removeRefreshToken,
  removeToken,
  setRefreshToken,
  setToken,
} from "@utils/auth";
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

    /**
     * Proactive refresh timer. We decode the JWT's `exp` and schedule a
     * `fetchRefreshToken()` 5 minutes before it dies, so a token expiring
     * mid-performance gets renewed silently instead of the user only
     * finding out via the next failing GraphQL call (which on the live
     * stage may not happen for an hour). Single-slot — re-login or logout
     * cancels the prior timer to prevent stacking.
     */
    const REFRESH_LEAD_MS = 5 * 60 * 1000;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelRefreshTimer = (): void => {
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const scheduleRefresh = (accessToken: string): void => {
      cancelRefreshTimer();
      const exp = decodeJwtExp(accessToken);
      if (exp == null) return;
      // Fire 5 min before exp. If we're already inside the lead window
      // (e.g. cold-boot resuming a token with <5 min left), fire on next
      // tick — fetchRefreshToken handles the actual server-side renewal.
      const delay = Math.max(0, exp * 1000 - Date.now() - REFRESH_LEAD_MS);
      refreshTimer = setTimeout(() => {
        void fetchRefreshToken();
      }, delay);
    };

    const setSession = (accessToken: string, refresh: string, name?: string): void => {
      token.value = accessToken;
      refreshToken.value = refresh;
      if (name !== undefined) username.value = name;
      setToken(accessToken);
      setRefreshToken(refresh);
      scheduleRefresh(accessToken);
    };

    const clear = (): void => {
      token.value = "";
      refreshToken.value = "";
      cancelRefreshTimer();
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
     * Clear local session and hard-navigate to the login page, preserving
     * the current location as `?redirect=` so the user lands back where
     * they were after re-authenticating. Previously this redirected to
     * `/` (Home), which dropped performers off the live stage with no
     * obvious next step. Route guards then re-evaluate from the
     * (now-empty) auth state.
     */
    const logout = (): void => {
      logoutLocal();
      const here = window.location.pathname + window.location.search;
      const isAtRootOrLogin = !here || here === "/" || here.startsWith("/login");
      const target = isAtRootOrLogin ? "/login" : `/login?redirect=${encodeURIComponent(here)}`;
      window.location.href = target;
    };

    /**
     * Explicit user-initiated logout (the navbar "logout" menu item).
     * Clears the local session and hard-navigates to the site root
     * (the public Home / landing page on the current origin —
     * dev.upstage.live in dev, upstage.live in prod) rather than the
     * login page. The forced/automatic `logout()` above keeps bouncing
     * to `/login?redirect=` so a user logged out by an expired token or
     * auth failure can re-authenticate and land back where they were;
     * a deliberate click should drop them on the home page instead.
     */
    const logoutToHome = (): void => {
      logoutLocal();
      window.location.href = `${window.location.origin}/`;
    };

    /**
     * Exchange the refresh token for a new access token. Used by the
     * Apollo error link on `Signature has expired` / `Authenticated
     * Failed` and by the proactive `scheduleRefresh()` timer below.
     * Resolves with the new access token on success; on failure clears
     * the session and bounces the user to /login (with redirect=).
     *
     * The success path re-arms `scheduleRefresh` because we mutate
     * `token.value`, which the boot-time watcher below observes.
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
        logout();
        return undefined;
      }
    };

    // Boot-time arm: pinia-plugin-persistedstate hydrates `token.value`
    // AFTER this setup function returns (initial state is "" → persisted
    // value), so a watcher is the only place that catches both:
    //   - the hydration write on cold-boot of a tab that already has a
    //     persisted token, and
    //   - any subsequent token mutation (login / refresh / logout).
    // `setSession` already calls `scheduleRefresh` directly so the timer
    // is armed synchronously after a fresh login; the watcher then
    // re-arms harmlessly on the next tick (cancel-then-set is idempotent).
    watch(
      token,
      (newToken) => {
        if (!newToken) {
          cancelRefreshTimer();
          return;
        }
        const exp = decodeJwtExp(newToken);
        if (exp != null && exp * 1000 <= Date.now()) {
          // Hydrated a token that's already past `exp` — don't try to use
          // it; bounce straight to /login so the user sees the issue and
          // can re-authenticate. Avoids the silent "expired token sitting
          // in storage, every GraphQL call 401s" state on tab resume.
          logout();
          return;
        }
        scheduleRefresh(newToken);
      },
      { immediate: false },
    );

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
      logoutToHome,
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

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAuthStore, import.meta.hot));
}
