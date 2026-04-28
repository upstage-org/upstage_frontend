import type { Page } from "@playwright/test";

/**
 * Wraps the login form rendered by `src/components/LoginForm.vue`.
 *
 * The SPA stores its JWT in vuex-persistedstate under the `vuex` localStorage
 * key, so a successful submit is observable both as a navigation away from
 * /login and as a populated `vuex.auth.token`.
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
   */
  async getAuthToken(): Promise<string | null> {
    return this.page.evaluate(() => {
      const raw = window.localStorage.getItem("vuex");
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed?.auth?.token ?? null;
      } catch {
        return null;
      }
    });
  }
}
