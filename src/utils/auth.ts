import Cookies from "js-cookie";
import store from "@stores/index";
import { computed } from "vue";
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

export const loggedIn = computed<boolean>(() => store.getters["auth/loggedIn"]);
export const logout = (): Promise<void> => store.dispatch("auth/logout");

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
