import { expect, test } from "@playwright/test";

test.describe("media @smoke", () => {
  test("media list page reachable when authenticated stub", async ({ page, context }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem(
        "vuex",
        JSON.stringify({
          auth: {
            username: "tester",
            token: "fake-jwt",
            refresh_token: "fake-refresh",
          },
        }),
      );
    });

    await page.route("**/studio_graphql", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            mediaList: { edges: [], pageInfo: { hasNextPage: false } },
            currentUser: { id: 1, username: "tester", isAdmin: false },
            whoami: { isAdmin: false, isGuest: false },
          },
        }),
      });
    });

    await page.goto("/media");
    await expect(page.locator("#app")).toBeVisible();
  });
});
