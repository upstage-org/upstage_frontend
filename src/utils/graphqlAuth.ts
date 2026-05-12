import Cookies from "js-cookie";
import { getSharedAuth } from "utils/common";

const ACCESS = "access_token";
const REFRESH = "refresh_token";

/**
 * Resolves a JWT for Apollo without importing the auth store directly
 * (avoids the circular import `store → graphql → apollo → store`).
 *
 * Resolution order:
 *   1. `getSharedAuth()` — reads the persisted auth blob from
 *      `localStorage` (kept in sync with the live Pinia auth store via
 *      `pinia-plugin-persistedstate`, with a fallback to the legacy
 *      `vuex` key for stale tabs — see `utils/common.ts`).
 *   2. Cookie set by `setToken` / `setRefreshToken` in `utils/auth`.
 */
function parseCookieAccessToken(): string | undefined {
  const raw = Cookies.get(ACCESS);
  if (raw == null || raw === "") return undefined;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return raw;
  }
}

function cookieRefreshToken(): string | undefined {
  return Cookies.get(REFRESH) ?? undefined;
}

export function getAccessTokenForGraphql(): string | undefined {
  const fromStore = getSharedAuth()?.token;
  if (typeof fromStore === "string" && fromStore.length > 0) {
    return fromStore;
  }
  return parseCookieAccessToken();
}

export function getRefreshTokenForGraphql(): string | undefined {
  const r = getSharedAuth()?.refresh_token;
  if (typeof r === "string" && r.length > 0) {
    return r;
  }
  return cookieRefreshToken();
}
