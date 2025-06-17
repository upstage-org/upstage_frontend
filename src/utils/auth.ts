// @ts-nocheck
import Cookies from "js-cookie";
import { computed } from "vue";
import { ROLES } from "../constants";
import { titleCase } from "./common";
import { useAuthStore } from "store/modules/auth";

// Constants
const ACCESS_TOKEN = "access_token";
const REFRESH_TOKEN = "refresh_token";

// Types
interface User {
  displayName?: string;
  firstName?: string;
  lastName?: string;
  username: string;
  role: string | number;
}

// Token management
export const setToken = (token: string): void => {
  Cookies.set(ACCESS_TOKEN, JSON.stringify(token), { secure: true });
};

export const getToken = (): string | undefined => {
  const token = Cookies.get(ACCESS_TOKEN);
  return token ? JSON.parse(token) : undefined;
};

export const removeToken = (): void => {
  Cookies.remove(ACCESS_TOKEN);
};

export const setRefreshToken = (token: string): void => {
  Cookies.set(REFRESH_TOKEN, token);
};

export const getRefreshToken = (): string | undefined => {
  return Cookies.get(REFRESH_TOKEN);
};

export const removeRefreshToken = (): void => {
  Cookies.remove(REFRESH_TOKEN);
};

// Auth state
export const loggedIn = computed(() => {
  const authStore = useAuthStore();
  return authStore.loggedIn;
});

export const logout = (): void => {
  const authStore = useAuthStore();
  authStore.logout();
};

// User utilities
export function displayName(user: User | null): string {
  if (!user) return "";
  if (user.displayName?.trim()) return user.displayName;
  if (user.firstName || user.lastName) {
    return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  }
  return user.username;
}

export function displayRole(user: User): string | undefined {
  for (const role in ROLES) {
    if (String(ROLES[role]) === String(user.role)) {
      return titleCase(role);
    }
  }
  return undefined;
}