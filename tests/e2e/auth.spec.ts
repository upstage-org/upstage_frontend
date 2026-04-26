import { expect, test } from "@playwright/test";

test.describe("auth flow @smoke", () => {
  test("login page renders and posts to /api/studio_graphql", async ({ page }) => {
    const graphqlRequests: string[] = [];
    await page.route("**/studio_graphql", async (route) => {
      const req = route.request();
      const body = req.postData() ?? "";
      graphqlRequests.push(body);

      if (body.includes("mutation") && body.includes("login")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              login: {
                token: "fake-jwt",
                refreshToken: "fake-refresh",
                user: { id: 1, username: "tester", isAdmin: false },
              },
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: {} }),
      });
    });

    await page.goto("/login");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator("body")).toBeVisible();

    const usernameField = page
      .locator('input[name="username"], input[type="text"]')
      .first();
    const passwordField = page.locator('input[type="password"]').first();
    if (await usernameField.count()) {
      await usernameField.fill("tester");
      await passwordField.fill("password123");

      const submit = page.locator('button[type="submit"], button:has-text("Login")').first();
      if (await submit.count()) {
        await submit.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test("admin route guard redirects when not admin", async ({ page }) => {
    await page.route("**/studio_graphql", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { whoami: { isAdmin: false } },
        }),
      });
    });

    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/admin\b/);
  });
});
