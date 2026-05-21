import type { Page } from "@playwright/test";

/**
 * Wraps the login form rendered by `src/components/LoginForm.vue`.
 *
 * After Phase 5 (Vuex → Pinia for auth) the SPA persists the JWT under the
 * `upstage-auth` localStorage key via `pinia-plugin-persistedstate` (the
 * old `vuex-persistedstate` plugin and its `vuex` key were removed). A
 * successful submit is observable both as a navigation away from /login
 * and as a populated `upstage-auth.token`.
 */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/login");
    await this.page.waitForLoadState("domcontentloaded");
  }

  async login(username: string, password: string): Promise<void> {
    await this.goto();
    await this.page.locator('input[name="username"]').first().fill(username);
    await this.page.locator('input[type="password"]').first().fill(password);
    await Promise.all([
      this.page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 15_000,
      }),
      this.page.locator('button[type="submit"]').first().click(),
    ]);
  }

  /**
   * Reads the JWT off localStorage. Useful when a spec wants to call the
   * GraphQL endpoint directly with the same identity.
   *
   * Reads from the Pinia auth persistence key. Falls back to the legacy
   * `vuex` key for environments that may still be serving a pre-Phase-5
   * bundle (e.g. an unrebuilt dev container) so a transient mismatch
   * between source and bundle doesn't cascade as a "no token" failure.
   */
  async getAuthToken(): Promise<string | null> {
    return this.page.evaluate(() => {
      const tryParse = (key: string): string | null => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          return parsed?.token ?? parsed?.auth?.token ?? null;
        } catch {
          return null;
        }
      };
      return tryParse("upstage-auth") ?? tryParse("vuex");
    });
  }
}
