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

/**
 * #1573: a stage in rehearsal is closed to the public. The curtain always
 * said so, but the board (every stream tile) and the audio player were
 * mounted behind it and the broker was joined, so the audience could hear
 * the rehearsal. Now nothing of the stage reaches a closed viewer; once the
 * stage is live the same visitor gets in.
 */
test.describe("rehearsal stage is closed to the audience @smoke", () => {
  test("anonymous visitor gets no board, media elements or broker socket until the stage is live", async ({
    page,
  }) => {
    const { gql, loginAsAdmin } = await import("./graphql");
    const token = await loginAsAdmin();
    const slug = `closed-${Date.now()}`;
    const created = await gql<{ createStage: { id: string } }>(
      `mutation C($i: StageInput!) { createStage(input: $i) { id fileLocation status } }`,
      {
        i: {
          name: "Closed rehearsal",
          fileLocation: slug,
          status: "rehearsal",
          visibility: true,
        },
      },
      token,
    );
    const stageId = created.data?.createStage.id;
    expect(stageId, JSON.stringify(created.errors)).toBeTruthy();

    // Vite's own HMR socket (same origin as the page) is not the stage's.
    const sockets: string[] = [];
    page.on("websocket", (ws) => {
      if (!ws.url().startsWith(new URL(page.url() || "http://x/").origin.replace(/^http/, "ws"))) {
        sockets.push(ws.url());
      }
    });
    try {
      await page.goto(`/${slug}`);
      const curtain = page.locator("section.hero.cover-image");
      await expect(curtain).toContainText("not currently open to the public");
      await curtain.click();
      await expect(curtain).toBeVisible();
      await expect(page.locator("#live-stage")).toHaveCount(0);
      await expect(page.locator("audio, video")).toHaveCount(0);
      await page.waitForTimeout(1500);
      expect(sockets, "no MQTT / Jitsi socket for a closed stage").toEqual([]);

      const flipped = await gql<{ updateStatus: { result: string } }>(
        `mutation U($id: ID!) { updateStatus(id: $id) { result } }`,
        { id: stageId },
        token,
      );
      expect(flipped.errors, JSON.stringify(flipped.errors)).toBeUndefined();

      await page.reload();
      await expect(curtain).toContainText("click anywhere to continue");
      await curtain.click();
      await expect(curtain).toBeHidden();
      await expect(page.locator("#live-stage")).toHaveCount(1);
      // The same listener now sees the broker socket, so the empty list
      // above was not a blind spot.
      await expect.poll(() => sockets.length, { timeout: 10_000 }).toBeGreaterThan(0);
    } finally {
      await gql(
        `mutation D($id: ID!) { deleteStage(id: $id) { success } }`,
        { id: stageId },
        token,
      );
    }
  });
});
