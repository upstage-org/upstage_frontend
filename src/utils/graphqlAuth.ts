import Cookies from "js-cookie";
import { getSharedAuth } from "utils/common";

const ACCESS = "access_token";
const REFRESH = "refresh_token";

/**
 * Resolves a JWT for Apollo the same way the old `graphql-request` path did, but
 * without importing the Vuex store (avoids circular imports: `store` → `graphql` → `apollo` → `store`).
 *
 * 1) `getSharedAuth()` — `vuex` persisted `auth` module (in sync with the live store)
 * 2) Legacy cookie — login uses `setToken` / `setRefreshToken` in `utils/auth` alongside Vuex
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
  const fromVuex = getSharedAuth()?.token;
  if (typeof fromVuex === "string" && fromVuex.length > 0) {
    return fromVuex;
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
