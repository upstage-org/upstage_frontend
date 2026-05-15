import Cookies from "js-cookie";
import { computed } from "vue";
import { useAuthStore } from "@stores/pinia/auth";
import { ROLES } from "./constants";
import { titleCase } from "./common";

const ACCESS_TOKEN = "access_token";
const REFRESH_TOKEN = "refresh_token";

export interface AuthUser {
  username?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  role?: string | number;
}

export const setToken = (token: unknown): void => {
  Cookies.set(ACCESS_TOKEN, JSON.stringify(token), { secure: true });
};
export const getToken = (): string | undefined => Cookies.get(ACCESS_TOKEN);
export const removeToken = (): void => Cookies.remove(ACCESS_TOKEN);

export const setRefreshToken = (token: string): string | undefined =>
  Cookies.set(REFRESH_TOKEN, token);
export const getRefreshToken = (): string | undefined => Cookies.get(REFRESH_TOKEN);
export const removeRefreshToken = (): void => Cookies.remove(REFRESH_TOKEN);

// `useAuthStore` is invoked lazily inside the callbacks (not at module load),
// which keeps the utils/auth ↔ pinia/auth import cycle resolvable: the store
// uses ES-module live bindings to call `setToken`/`removeToken` exported here.
export const loggedIn = computed<boolean>(() => useAuthStore().loggedIn);
export const logout = (): void => useAuthStore().logout();

export function displayName(user: AuthUser | null | undefined): string {
  if (!user) return "";
  if (user.displayName?.trim()) return user.displayName;
  if (user.firstName || user.lastName) {
    return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  }
  return user.username ?? "";
}

export function displayRole(user: AuthUser): string | undefined {
  for (const role in ROLES) {
    if (String((ROLES as Record<string, number>)[role]) === String(user.role)) {
      return titleCase(role);
    }
  }
  return undefined;
}

/**
 * Decode the `exp` (expiry) claim from a JWT without verifying the signature.
 * The server still verifies on every request — this is just so the SPA can
 * (a) schedule a proactive refresh before the token dies and (b) detect a
 * stale token on cold boot / on tab focus, instead of relying on a GraphQL
 * call to surface the expiry.
 *
 * Returns the `exp` value in seconds-since-epoch (as JWTs encode it), or
 * `null` if the token is malformed / lacks an `exp` / cannot be base64-
 * decoded. Callers should treat `null` as "unknown — do nothing", not
 * "expired"; an invalid token will be caught by the GraphQL error path
 * the next time it's used.
 *
 * Implementation note: JWT payloads are base64URL (`-`/`_` instead of
 * `+`/`/`) without padding. atob() requires the standard alphabet, so
 * normalise and re-pad before decoding. Keep this dependency-free —
 * pulling in jwt-decode for ~10 lines is not worth the install.
 */
export function decodeJwtExp(token: string | undefined | null): number | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4;
    if (pad) payload += "=".repeat(4 - pad);
    const decoded = JSON.parse(atob(payload)) as { exp?: unknown };
    if (typeof decoded.exp === "number" && isFinite(decoded.exp)) {
      return decoded.exp;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True iff the token's `exp` is strictly in the past (relative to the
 * caller's clock). `null` exp (unknown) and tokens with no `exp` claim
 * return `false` so we never trigger a phantom logout for tokens we
 * cannot reason about.
 */
export function isJwtExpired(token: string | undefined | null): boolean {
  const exp = decodeJwtExp(token);
  if (exp == null) return false;
  return exp * 1000 <= Date.now();
}
