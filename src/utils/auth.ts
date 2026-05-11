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
