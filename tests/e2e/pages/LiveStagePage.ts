import type { Locator, Page } from "@playwright/test";

export type ChatMode = "speak" | "shout" | "think" | "audience";

/**
 * Drives the live stage view at /:url which mounts views/live/Layout.vue.
 *
 * Realtime features use MQTT; **getting onto the board** is GraphQL (`loadStage`)
 * plus Preloader (media + click). Do not conflate a stuck load with MQTT.
 *
 * `Preloader.vue` covers the app with a full-height `section.hero` until the
 * user clicks — see `v-if` on the transition and the @click on that section
 * (even when `store.getters['stage/ready']` is already true). We must dismiss
 * that layer before the board is interactable/visible in Playwright.
 */
export class LiveStagePage {
  constructor(private readonly page: Page) {}

  async goto(stageSlug: string): Promise<void> {
    await this.page.goto(`/${stageSlug}`);
    await this.page.waitForLoadState("domcontentloaded");
    // 1) `loadStage` (GraphQL). Avoid `waitFor({ hidden })` on "Loading…" before
    //    that node exists (0 matches → resolves too early). Wait until the loading
    //    line is gone and Preloader shows an `h1.title` (model name or "Stage not found").
    try {
      await this.page.waitForFunction(
        () => {
          const body = document.body?.innerText ?? "";
          if (body.includes("Loading stage information")) return false;
          return document.querySelector("section.hero h1.title") != null;
        },
        { timeout: 120_000 },
      );
    } catch {
      throw new Error(
        `[e2e] loadStage did not finish for /${stageSlug} within 120s — ` +
          "no `h1.title` after GraphQL; check /api → studio, auth, and VITE_GRAPHQL_ENDPOINT (not MQTT).",
      );
    }
    const heroTitle = (
      await this.page.locator("section.hero h1.title").first().innerText()
    ).trim();
    // Match the copy in Preloader.vue — not a substring of a long play title.
    if (heroTitle === "Stage not found!") {
      throw new Error(`[e2e] Stage not found: /${stageSlug}`);
    }
    const closed = this.page.getByText(/not currently open to the public/i);
    if (await closed.isVisible().catch(() => false)) {
      throw new Error(
        `[e2e] Live stage is not open for this user — check status / canPlay: /${stageSlug}`,
      );
    }
    // 2) Optional "Preloading media... x/y" (Preloader.vue) before `ready` flips; the
    //    app can also call stopLoading() after 60s when status is live, but a broken
    //    image URL can block — wait for the preload copy to go away, then the click line.
    const preloading = this.page.getByText(/Preloading media/);
    if (await preloading.isVisible().catch(() => false)) {
      await preloading.waitFor({ state: "hidden", timeout: 150_000 });
    }
    // 3) Full-screen `section.hero` until the user clicks (even with stage/ready)
    const hero = this.page.locator("section.hero.is-fullheight").first();
    await hero.waitFor({ state: "visible", timeout: 10_000 });
    await this.page
      .getByText(/click anywhere to continue/i)
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    await hero.click();
    await this.page
      .locator('#board, [data-testid="board"]')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
  }

  /**
   * Type a chat line and submit. ChatMode is encoded as a prefix per
   * src/components/form/ChatInput.vue — `:` think, `!` shout, `-` audience,
   * default speak. The component derives `behavior` from the prefix and
   * surfaces it on the wrapper as `data-chat-mode`.
   */
  async sendChat(text: string, mode: ChatMode = "speak"): Promise<void> {
    const prefix = mode === "think" ? ":" : mode === "shout" ? "!" : mode === "audience" ? "-" : "";
    const input = this.chatInput();
    await input.waitFor({ state: "visible", timeout: 10_000 });
    await input.click();
    await input.fill("");
    await input.type(`${prefix}${text}`, { delay: 5 });
    await input.press("Enter");
  }

  /**
   * Drag an object's wrapper (Object.vue) from its current screen position to
   * a target client-coordinate inside the board. The Moveable wrapper handles
   * pointerdown/move/up but a plain mouse drag works for our simple "walk to
   * (x,y)" beats.
   */
  async moveObjectByName(objectName: string, to: { x: number; y: number }): Promise<void> {
    const target = this.objectByName(objectName);
    await target.waitFor({ state: "visible", timeout: 10_000 });
    const box = await target.boundingBox();
    if (!box) throw new Error(`[e2e] object ${objectName} has no bounding box`);

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    const board = this.page.locator('[data-testid="board"]').first();
    const boardBox = await board.boundingBox();
    if (!boardBox) throw new Error("[e2e] board has no bounding box");

    const targetX = boardBox.x + to.x;
    const targetY = boardBox.y + to.y;

    await this.page.mouse.move(startX, startY);
    await this.page.mouse.down();
    // Move in steps so framer-style animations track.
    await this.page.mouse.move(targetX, targetY, { steps: 12 });
    await this.page.mouse.up();
  }

  objectByName(name: string): Locator {
    return this.page.locator(`[data-testid="object-${name}"]`).first();
  }

  chatInput(): Locator {
    return this.page.locator('[data-testid="chat-input"] textarea, [data-testid="chat-input"] input').first();
  }

  /**
   * Speech bubbles render inside Avatar wrappers; finding them by parent
   * data-testid lets us scope per persona without colliding with other
   * avatars on stage.
   */
  speechBubbleFor(name: string): Locator {
    return this.page
      .locator(`[data-testid="object-${name}"] .speech-bubble, [data-testid="object-${name}"] .bubble`)
      .first();
  }
}
