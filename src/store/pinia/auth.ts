import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { message } from "ant-design-vue";
import {
  decodeJwtExp,
  isJwtExpired,
  removeRefreshToken,
  removeToken,
  setRefreshToken,
  setToken,
} from "@utils/auth";
import {
  hardNavigate,
  loginUrlFor,
  markSessionExpired,
  MAX_TIMER_DELAY_MS,
} from "@utils/sessionExpiry";
import { getSharedAuth } from "@utils/common";
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

const AUTH_STORAGE_KEY = "upstage-auth";
const LEGACY_AUTH_STORAGE_KEY = "vuex";

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
    // When the server could not be reached, try again this much later (the
    // token is still valid for the rest of the lead window).
    const REFRESH_RETRY_MS = 30 * 1000;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    // Set once this page is on its way out (see logout()).
    let leaving = false;

    /**
     * A performance must not be interrupted. While a stage is open (the
     * Live view holds the session, see holdForStage()), a login that ends
     * is only remembered: nothing is cleared and nothing navigates, so the
     * player keeps their place, their tools and their broker connection.
     * The logout is completed when they leave the stage.
     */
    let stageHolds = 0;
    const sessionEndDeferred = ref<boolean>(false);

    /**
     * Deferring keeps the stage running, but a request that needs a login
     * would still fail. So the player is asked to log in again on the stage
     * (views/live/ReauthPrompt.vue); the new tokens replace the dead ones in
     * the running session, and the requests that were waiting for them are
     * replayed (apollo.ts). `reauthDismissed` is the player answering
     * "later": waiting requests are then told the login has expired.
     */
    const reauthDismissed = ref<boolean>(false);
    let reauthWaiters: Array<(accessToken: string | null) => void> = [];
    const settleReauthWaiters = (accessToken: string | null): void => {
      const waiters = reauthWaiters;
      reauthWaiters = [];
      waiters.forEach((resolve) => resolve(accessToken));
    };

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
      if (delay > MAX_TIMER_DELAY_MS) {
        // A 30-day token is further away than a timer can wait: a longer
        // delay overflows and fires at once, which renewed the token in a
        // tight loop. Wait as long as possible, then look again.
        refreshTimer = setTimeout(() => scheduleRefresh(accessToken), MAX_TIMER_DELAY_MS);
        return;
      }
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
      // A new token pair is a working login again (e.g. logged in on stage).
      sessionEndDeferred.value = false;
      reauthDismissed.value = false;
      scheduleRefresh(accessToken);
      settleReauthWaiters(accessToken);
    };

    const clear = (): void => {
      token.value = "";
      refreshToken.value = "";
      sessionEndDeferred.value = false;
      reauthDismissed.value = false;
      cancelRefreshTimer();
      settleReauthWaiters(null);
    };

    const logoutLocal = (): void => {
      clear();
      // Only the auth blob: `localStorage.clear()` also wiped the locale,
      // replay markers and other per-viewer preferences on every logout.
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
      } catch {
        /* storage may be unavailable (private mode) */
      }
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
     *
     * While a stage is open the logout is deferred instead (see
     * `stageHolds`). Returns whether the page is leaving for the login page.
     */
    /**
     * A player often has several windows on one login: the stage, a
     * popped-out chat, the studio. They share the stored login but each has
     * its own copy in memory. When another window has renewed the login or
     * logged in again, this window takes those tokens over instead of
     * treating its own, older copy as the end of the session.
     */
    const adoptSharedSession = (): boolean => {
      const shared = getSharedAuth();
      const sharedToken = shared?.token;
      if (typeof sharedToken !== "string" || !sharedToken || sharedToken === token.value) {
        return false;
      }
      if (isJwtExpired(sharedToken)) return false;
      const ours = decodeJwtExp(token.value);
      const theirs = decodeJwtExp(sharedToken);
      const newer = ours == null || theirs == null || theirs > ours;
      if (!newer && !sessionEndDeferred.value && !isJwtExpired(token.value)) return false;
      setSession(sharedToken, shared?.refresh_token ?? "");
      return true;
    };

    const leaveForLogin = (location: string): void => {
      // Several requests usually fail together when a session ends; only
      // the first one navigates.
      if (leaving) return;
      leaving = true;
      logoutLocal();
      markSessionExpired();
      hardNavigate(loginUrlFor(location));
    };

    const logout = (): boolean => {
      if (leaving) return true;
      // Another window holds a working login: this one is not over.
      if (adoptSharedSession()) return false;
      if (stageHolds > 0) {
        // Nothing can renew this login any more: stop trying.
        cancelRefreshTimer();
        sessionEndDeferred.value = true;
        return false;
      }
      leaveForLogin(window.location.pathname + window.location.search);
      return true;
    };

    /**
     * For a request that was refused because the login ended on a stage:
     * resolves with the new access token once the player has logged in
     * again, or with null when they chose not to (or the login is cleared).
     */
    const waitForReauth = (): Promise<string | null> => {
      if (!sessionEndDeferred.value) return Promise.resolve(token.value || null);
      if (reauthDismissed.value) return Promise.resolve(null);
      return new Promise((resolve) => reauthWaiters.push(resolve));
    };

    /** The player's "later": the prompt closes, waiting requests fail. */
    const dismissReauth = (): void => {
      reauthDismissed.value = true;
      settleReauthWaiters(null);
    };

    /** Opens the prompt again after a "later". */
    const requestReauth = (): void => {
      reauthDismissed.value = false;
    };

    /**
     * Logs the SAME player in again inside the running session. Rejects
     * with a message for the prompt; nothing changes unless it succeeds.
     */
    const reauthenticate = async (password: string, captchaToken?: string): Promise<void> => {
      const expected = username.value;
      let resp: LoginResponse;
      try {
        resp = (await userGraph.login({
          username: expected,
          password,
          ...(captchaToken ? { token: captchaToken } : {}),
        })) as LoginResponse;
      } catch (err: unknown) {
        const e = err as {
          response?: { errors?: Array<{ message?: string }> };
          message?: string;
        };
        throw new Error(
          e?.response?.errors?.[0]?.message ??
            (typeof e?.message === "string" ? e.message : "Login failed"),
          { cause: err },
        );
      }
      const login = resp?.login;
      if (!login?.access_token) {
        throw new Error(resp?.errors?.[0]?.message ?? "Login failed");
      }
      if (login.username && login.username.toLowerCase() !== expected.toLowerCase()) {
        // The stage session belongs to `expected`; another account's tokens
        // must not be swapped into it.
        throw new Error("Login failed");
      }
      setSession(login.access_token, login.refresh_token ?? "");
    };

    /** A login that is over but has not been cleared yet. */
    const logoutPending = (): boolean => {
      if (!token.value) return false;
      if (!sessionEndDeferred.value && !isJwtExpired(token.value)) return false;
      return !adoptSharedSession();
    };

    /**
     * Completes a deferred logout. Called when the player leaves the stage:
     * by the router with the page they are going to (so they arrive there
     * after logging in), and by the last released hold as a fallback.
     * Returns whether the page is leaving for the login page.
     */
    const finishDeferredLogout = (destination?: string): boolean => {
      if (leaving) return true;
      if (!logoutPending()) return false;
      leaveForLogin(destination ?? window.location.pathname + window.location.search);
      return true;
    };

    /**
     * The stage page itself is going away (a plain link, a reload, the tab
     * closing) with a logout still deferred. There is nothing left to
     * protect, so the dead login is cleared now: the next page starts
     * logged out and the route guard sends it to the login page, instead of
     * loading with a login the server refuses.
     */
    const dropEndedSession = (): boolean => {
      if (leaving || !logoutPending()) return false;
      logoutLocal();
      markSessionExpired();
      return true;
    };

    /**
     * Held by the Live view for as long as a stage is open. Returns the
     * release function; releasing the last hold completes a logout that was
     * deferred meanwhile.
     */
    const holdForStage = (): (() => void) => {
      stageHolds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        stageHolds -= 1;
        if (stageHolds === 0) finishDeferredLogout();
      };
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
      if (leaving) return;
      // The player's own choice: not deferred, even on a stage.
      leaving = true;
      logoutLocal();
      hardNavigate(`${window.location.origin}/`);
    };

    /**
     * Renew the token pair ahead of its expiry (the `scheduleRefresh()`
     * timer). Goes through the same single-flight refresh as the Apollo
     * error link: the backend rotates the refresh token on every use, so
     * two renewals racing each other would make the second one fail and
     * log the user out for no reason.
     *
     * Resolves with the new access token. When the server refuses the
     * renewal the session is over: it is cleared and the user is sent to
     * /login (with redirect=), or, on a stage, the logout is deferred. When
     * the server could not be reached the session is left alone and the
     * renewal is tried again shortly.
     */
    const fetchRefreshToken = async (): Promise<string | undefined> => {
      // Imported lazily to keep the `store → apollo → store` cycle open.
      const { refreshSessionOnce } = await import("../../apollo");
      const outcome = await refreshSessionOnce();
      if (outcome.status === "refreshed") {
        // setSession() has run (apollo's persistSession) and re-armed the timer.
        return outcome.accessToken;
      }
      if (outcome.status === "rejected") {
        logout();
        return undefined;
      }
      cancelRefreshTimer();
      refreshTimer = setTimeout(() => {
        void fetchRefreshToken();
      }, REFRESH_RETRY_MS);
      return undefined;
    };

    if (typeof window !== "undefined") {
      window.addEventListener("storage", (event) => {
        if (event.key === AUTH_STORAGE_KEY && event.newValue && token.value) {
          adoptSharedSession();
        }
      });
    }

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
      sessionEndDeferred,
      reauthDismissed,
      setSession,
      clear,
      logoutLocal,
      login,
      logout,
      logoutToHome,
      logoutPending,
      finishDeferredLogout,
      dropEndedSession,
      holdForStage,
      waitForReauth,
      dismissReauth,
      requestReauth,
      reauthenticate,
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
