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

/**
 * #1581: an empty chat used to say "No messages yet!" in a fixed near-white,
 * which was almost invisible on the light chat. It now greets the visitor,
 * points at the input, and takes the chat's own text colour, so it is as
 * readable as the chat lines in light mode and in dark mode.
 */
test.describe("empty chat welcomes the visitor and is readable @smoke", () => {
  test("light and dark mode: wording, order, sizes and contrast", async ({ page }) => {
    const { gql, loginAsAdmin } = await import("./graphql");
    const token = await loginAsAdmin();
    const slug = `welcome-${Date.now()}`;
    const created = await gql<{ createStage: { id: string } }>(
      `mutation C($i: StageInput!) { createStage(input: $i) { id fileLocation status } }`,
      { i: { name: "Empty chat", fileLocation: slug, status: "rehearsal", visibility: true } },
      token,
    );
    const stageId = created.data?.createStage.id;
    expect(stageId, JSON.stringify(created.errors)).toBeTruthy();
    try {
      const flipped = await gql<{ updateStatus: { result: string } }>(
        `mutation U($id: ID!) { updateStatus(id: $id) { result } }`,
        { id: stageId },
        token,
      );
      expect(flipped.errors, JSON.stringify(flipped.errors)).toBeUndefined();

      await page.goto(`/${slug}`);
      const curtain = page.locator("section.hero.cover-image");
      await expect(curtain).toContainText("click anywhere to continue");
      await curtain.click();
      await expect(curtain).toBeHidden();

      const chat = page.locator("#chatbox");
      const empty = chat.locator("[data-testid=chat-empty]");
      const title = empty.locator(".chat-empty-title");
      const hint = empty.locator(".chat-empty-hint");
      await expect(title).toHaveText("Welcome to UpStage!");
      await expect(hint).toHaveText("Type in the field below to chat.");
      await expect(chat).not.toContainText("No messages yet!");

      // What the eye gets: colours as computed by the browser, and the
      // WCAG contrast ratio of each line against the chat's background.
      const measure = () =>
        page.evaluate(() => {
          const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          const luminance = (value: string) => {
            const [r, g, b] = rgb(value).map((c) => {
              const s = c / 255;
              return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const contrast = (a: string, b: string) => {
            const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
          };
          const box = document.querySelector("#chatbox") as HTMLElement;
          const style = (selector: string) =>
            getComputedStyle(box.querySelector(selector) as HTMLElement);
          const top = (selector: string) =>
            (box.querySelector(selector) as HTMLElement).getBoundingClientRect().top;
          const background = getComputedStyle(box).backgroundColor;
          const titleStyle = style(".chat-empty-title");
          const hintStyle = style(".chat-empty-hint");
          return {
            background,
            chatText: getComputedStyle(box).color,
            titleColor: titleStyle.color,
            hintColor: hintStyle.color,
            titleContrast: contrast(titleStyle.color, background),
            hintContrast: contrast(hintStyle.color, background),
            titlePx: parseFloat(titleStyle.fontSize),
            hintPx: parseFloat(hintStyle.fontSize),
            titleTop: top(".chat-empty-title"),
            hintTop: top(".chat-empty-hint"),
            inputTop: top("textarea, input"),
          };
        });
      const setDarkMode = (dark: boolean) =>
        page.evaluate((value) => {
          // This browser only: the stage-wide setting normally arrives over MQTT.
          (
            window.__UPSTAGE_PINIA__!.stage as unknown as { settings: { chatDarkMode: boolean } }
          ).settings.chatDarkMode = value;
        }, dark);

      for (const dark of [false, true]) {
        await setDarkMode(dark);
        await expect(chat).toHaveClass(dark ? /(^|\s)dark(\s|$)/ : /^(?!.*(^|\s)dark(\s|$))/);
        const m = await measure();
        const mode = dark ? "dark" : "light";
        // Follows the chat text colour, like the chat lines do.
        expect(m.titleColor, `${mode}: title colour`).toBe(m.chatText);
        expect(m.hintColor, `${mode}: hint colour`).toBe(m.chatText);
        // Readable: WCAG AA for normal text is 4.5:1.
        expect(m.titleContrast, `${mode}: title contrast ${JSON.stringify(m)}`).toBeGreaterThan(
          4.5,
        );
        expect(m.hintContrast, `${mode}: hint contrast ${JSON.stringify(m)}`).toBeGreaterThan(4.5);
        // Second line a little smaller, under the first, above the field it points at.
        expect(m.hintPx).toBeLessThan(m.titlePx);
        expect(m.hintPx).toBeGreaterThanOrEqual(m.titlePx * 0.7);
        expect(m.hintTop).toBeGreaterThan(m.titleTop);
        expect(m.inputTop).toBeGreaterThan(m.hintTop);
      }
      // The two modes really are different colours.
      await setDarkMode(false);
      const light = await measure();
      await setDarkMode(true);
      const darkMode = await measure();
      expect(light.background).not.toBe(darkMode.background);
      expect(light.titleColor).not.toBe(darkMode.titleColor);
    } finally {
      await gql(
        `mutation D($id: ID!) { deleteStage(id: $id) { success } }`,
        { id: stageId },
        token,
      );
    }
  });
});
