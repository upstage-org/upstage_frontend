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
    const heroTitle = (await this.page.locator("section.hero h1.title").first().innerText()).trim();
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
   * a target client-coordinate inside the board.
   *
   * `[data-testid="object-${name}"]` now lives on the sized `.object` div
   * inside Moveable's slot, so it has a real bounding box and is visible to
   * Playwright. This pointer-drag path is therefore usable, but for perform
   * `move` beats we still prefer `moveAvatar()` in `perform.spec.ts`
   * (dispatches `stage/shapeObject` directly via the dev store hook), which is
   * what the SPA itself does after a real drag finishes — no fragile pointer
   * timing, and it works even when the board is not in the viewport.
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
    // ChatInput.vue renders a single <textarea class="textarea"> via ElasticInput.
    // The wrapper also embeds <emoji-picker> (a custom element) whose Shadow DOM
    // contains <input id="search"> for emoji search; Playwright pierces shadow DOM
    // by default, so a comma selector that includes `input` resolved to the hidden
    // emoji-search field on `.first()` and `waitFor({ visible })` timed out.
    // Stick to `textarea` — the emoji picker has none, so this is unambiguous.
    return this.page.locator('[data-testid="chat-input"] textarea').first();
  }

  /**
   * Speech bubbles live in `Topping.vue`, teleported to `document.body`, so
   * they are not under `[data-testid="object-*"]`. The topping wrapper uses
   * `data-testid="speech-topping-${object.name}"` and the `.bubble` is
   * conditionally rendered while `object.speak` is set.
   *
   * This is the canonical assertion for **player speech** (in-world
   * bubble + TTS, dispatched via `stage/speakAsAvatar` → `TOPICS.BOARD/SPEAK`,
   * intentionally not in the chat log). The bubble is ephemeral: Topping's
   * `BUBBLE_TIMEOUT` is 5s and `SET_OBJECT_SPEAK` clears `object.speak` after
   * 1s + 1s/word — assert promptly after the dispatch.
   */
  speechBubbleFor(name: string): Locator {
    return this.page.getByTestId(`speech-topping-${name}`).locator(".bubble").first();
  }

  /**
   * Public chat log entry (Chat/index.vue → Messages.vue). Each `<p>` in
   * `#chatbox` is one message: `<small><b>{user}:</b></small>` + `<span
   * class="tag message">…{message}…</span>`. We narrow by both the speaker
   * label and a substring of the line so repeats from the same persona stay
   * unambiguous. Used for OOC chat assertions (and as a *negative* assertion
   * to prove player speech did NOT leak into the chat log).
   */
  chatLogEntryFor(speakerLabel: string, lineSubstring: string): Locator {
    return this.page
      .locator("#chatbox p")
      .filter({ hasText: `${speakerLabel}:` })
      .filter({ hasText: lineSubstring });
  }

  // ---------------------------------------------------------------------
  // Vuex dev-hook helpers
  // ---------------------------------------------------------------------
  // Builds (`pnpm dev` and `vite build` with VITE_E2E=1) expose the live
  // Vuex store under `window.__UPSTAGE_STORE__` (see src/main.ts). These
  // helpers wrap the boilerplate so individual specs don't have to repeat
  // the cast + null-check + dispatch dance for every action.

  /**
   * Read a slice of stage state on the page. Useful for cross-client
   * assertions where the spec needs to wait for an MQTT-delivered mutation
   * to land in the audience's local Vuex (see e.g. `pollUntilStateMatches`
   * in features.spec.ts).
   *
   * Returns `null` if the dev hook isn't installed (production build
   * without VITE_E2E) so callers can emit a clearer error than
   * "evaluate failed".
   */
  async getStageState<T = unknown>(selectorPath: string): Promise<T | null> {
    return this.page.evaluate((path: string): T | null => {
      type DevStore = { state: { stage: Record<string, unknown> } };
      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      if (!store) return null;
      // Walk dot-path against state.stage. Returning `null` for any missing
      // segment keeps callers from having to special-case partial paths.
      const segments = path.split(".").filter(Boolean);
      let cursor: unknown = store.state.stage;
      for (const seg of segments) {
        if (cursor == null || typeof cursor !== "object") return null;
        cursor = (cursor as Record<string, unknown>)[seg];
      }
      return (cursor ?? null) as T | null;
    }, selectorPath);
  }

  /**
   * Dispatch a Vuex action on the page. Awaits the action's resolved value
   * (so callers chaining on async actions like `placeObjectOnStage` can
   * read back the new object id).
   *
   * Throws via the dev hook if the store isn't exposed — that's a
   * configuration regression and we want it loud.
   */
  async dispatchAction<TPayload = unknown, TResult = unknown>(
    type: string,
    payload?: TPayload,
  ): Promise<TResult> {
    return this.page.evaluate(
      async ({ actionType, actionPayload }: { actionType: string; actionPayload: unknown }) => {
        type DevStore = { dispatch: (t: string, p?: unknown) => Promise<unknown> };
        const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
        if (!store) throw new Error("Vuex store not exposed (__UPSTAGE_STORE__ missing).");
        return (await store.dispatch(actionType, actionPayload)) as unknown;
      },
      { actionType: type, actionPayload: payload ?? null },
    ) as Promise<TResult>;
  }

  /**
   * Commit a Vuex mutation on the page. Used for the rare cases where a
   * spec needs to bypass an action wrapper (e.g. `SET_REPLAY` for replay
   * speed). Prefer `dispatchAction` whenever an action is available, since
   * actions handle MQTT broadcasts.
   */
  async commitMutation<TPayload = unknown>(type: string, payload?: TPayload): Promise<void> {
    await this.page.evaluate(
      ({ mutationType, mutationPayload }: { mutationType: string; mutationPayload: unknown }) => {
        type DevStore = { commit: (t: string, p?: unknown) => void };
        const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
        if (!store) throw new Error("Vuex store not exposed (__UPSTAGE_STORE__ missing).");
        store.commit(mutationType, mutationPayload);
      },
      { mutationType: type, mutationPayload: payload ?? null },
    );
  }
}
