/**
 * What happens when a login can no longer be used: the session is cleared
 * and the browser is sent to the login page, which explains why.
 *
 * The navigation is a full page load (it resets every store and drops the
 * requests that were in flight), so the reason cannot travel in memory; it
 * is left in sessionStorage for the login page to pick up once.
 */

const NOTICE_KEY = "upstage:sessionExpired";

/** What a request is told when the login ended but the player is still on a stage. */
export const SESSION_ENDED_MESSAGE =
  "Your login has expired. Log in again after leaving the stage.";

/** Longest delay a browser timer accepts; anything above fires immediately. */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

export function markSessionExpired(): void {
  try {
    sessionStorage.setItem(NOTICE_KEY, "1");
  } catch {
    /* storage may be unavailable (private mode): the redirect still happens */
  }
}

/** True once after markSessionExpired(); reading it clears it. */
export function consumeSessionExpiredNotice(): boolean {
  try {
    const marked = sessionStorage.getItem(NOTICE_KEY) === "1";
    sessionStorage.removeItem(NOTICE_KEY);
    return marked;
  } catch {
    return false;
  }
}

/**
 * Where a user whose session ended goes: the login page, carrying the page
 * they were on so they return to it after logging in.
 */
export function loginUrlFor(location: string | undefined | null): string {
  const here = location ?? "";
  if (!here || here === "/" || here.startsWith("/login")) return "/login";
  return `/login?redirect=${encodeURIComponent(here)}`;
}

/**
 * Replaces the current history entry, so Back from the login page does not
 * land on the page that just bounced.
 */
export function hardNavigate(url: string): void {
  window.location.replace(url);
}
