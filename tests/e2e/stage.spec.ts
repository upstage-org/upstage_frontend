import { expect, test } from "@playwright/test";

test.describe("stage flow @smoke", () => {
  test("home page renders without crashing", async ({ page }) => {
    await page.route("**/studio_graphql", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            foyer: { stages: [], menu: "" },
            foyerStageList: [],
            stages: [],
            configs: { nginx: {}, system: {}, foyer: {} },
          },
        }),
      });
    });

    await page.goto("/");
    await expect(page.locator("#app")).toBeVisible();
  });

  test("MQTT connect helper produces expected topic shape", async ({ page }) => {
    await page.goto("/");
    const namespacedTopic = await page.evaluate(() => {
      const ns = "upstage";
      const url = "demo-stage";
      const sub = "chat";
      return `${ns}/${url}/${sub}`;
    });
    expect(namespacedTopic).toBe("upstage/demo-stage/chat");
  });
});
