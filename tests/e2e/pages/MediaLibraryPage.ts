import type { Page } from "@playwright/test";

export type MediaType =
  | "avatar"
  | "prop"
  | "media"
  | "backdrop"
  | "audio"
  | "video"
  | "scene";

export interface UploadOptions {
  /** Absolute path to the file on disk. */
  filePath: string;
  /** Display name shown in the media library. */
  name: string;
  /** Maps to MediaForm's "type" select. */
  mediaType: MediaType;
  /** Username of the persona who should own this media. */
  ownerUsername: string;
}

/**
 * Wraps the /media route. The SPA opens MediaForm.vue automatically as soon as
 * a file is dropped onto Dropzone.vue, so the upload path is:
 *   navigate -> setInputFiles -> wait for MediaForm modal -> set type/owner ->
 *   save -> wait for the row to appear in the library.
 */
export class MediaLibraryPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/media");
    await this.page.waitForLoadState("networkidle").catch(() => undefined);
    await this.page
      .locator("#app")
      .waitFor({ state: "visible", timeout: 15_000 });
  }

  /**
   * Dropzone.vue listens for `dragenter` on `window` to reveal itself, but
   * dispatching a synthetic DragEvent doesn't always flip Vue's reactive
   * `visible` ref (Ant Design's modal mounts its body lazily either way).
   * The /media view exposes a "+ New Media" button in MediaFilter.vue that
   * sets `visibleDropzone = true` directly — that's the ergonomic path.
   * The modal wrapper carries `wrapClassName="fullscreen-dragzone"`, which
   * is the most stable selector for the input inside it.
   */
  async upload({ filePath, name, mediaType, ownerUsername }: UploadOptions): Promise<void> {
    const newMediaBtn = this.page
      .locator("button", { hasText: /\bnew\s+media\b/i })
      .first();
    if (await newMediaBtn.count()) {
      await newMediaBtn.click();
    } else {
      // Fallback for non-/media routes that still embed Dropzone (cover image,
      // etc.) — the SPA listens for window dragenter to reveal it.
      await this.page.evaluate(() => {
        window.dispatchEvent(new DragEvent("dragenter", { bubbles: true }));
      });
    }

    const fileInput = this.page
      .locator('.fullscreen-dragzone input[type="file"]')
      .first();
    await fileInput.waitFor({ state: "attached", timeout: 10_000 });
    await fileInput.setInputFiles(filePath);

    // MediaForm modal opens once `files` is populated; the type/save controls
    // live on its toolbar/footer (see src/components/media/MediaForm/index.vue).
    const typeSelect = this.page
      .locator('[data-testid="media-form-type"]')
      .first();
    await typeSelect.waitFor({ state: "visible", timeout: 15_000 });

    // Set the friendly name first so a save later shows the row we expect.
    const nameInput = this.page.locator('[data-testid="media-form-name"]').first();
    if (await nameInput.count()) {
      await nameInput.fill("");
      await nameInput.fill(name);
    }

    await this.selectAntdValue(typeSelect, mediaType);

    // Owner is on the "Change Owner" tab.
    const ownerTab = this.page.locator('div[role="tab"]', { hasText: "Change Owner" }).first();
    if (await ownerTab.count()) {
      await ownerTab.click();
      const ownerSelect = this.page
        .locator('[data-testid="media-form-owner"]')
        .first();
      await ownerSelect.waitFor({ state: "visible", timeout: 5_000 });
      // That select uses show-search; options are not fully listed — type to filter.
      // rc-select surfaces the username on each option in the a11y tree; match
      // that exactly so `montague` does not pick `ladymontague`.
      await this.selectAntdValue(ownerSelect, ownerUsername, { useSearch: true });
    }

    await this.page.locator('[data-testid="media-form-save"]').first().click();

    // Save closes the modal; wait for it to disappear.
    await typeSelect.waitFor({ state: "hidden", timeout: 30_000 });
  }

  private async selectAntdValue(
    select: ReturnType<Page["locator"]>,
    value: string,
    options?: { useSearch?: boolean },
  ): Promise<void> {
    await select.click();
    // ant-design renders dropdown options to body via teleport.
    // Options often show display names (e.g. "Sampson") while the harness
    // passes usernames (e.g. "sampson") — match case-insensitively.
    const needle = new RegExp(
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    if (options?.useSearch) {
      // `show-search` + virtual list; the option's a11y `name` is the username
      // (see error-context snapshots) — use anchored username so `montague` ≠
      // `ladymontague`.
      await this.page.keyboard.type(value, { delay: 30 });
      const ev = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const option = this.page
        .locator(".ant-select-item-option")
        .filter({ hasText: new RegExp(`^\\s*${ev}\\s*$`, "i") })
        .first();
      await option.waitFor({ state: "attached", timeout: 10_000 });
      await option.scrollIntoViewIfNeeded();
      await option.click({ force: true });
      return;
    }
    const option = this.page
      .locator(".ant-select-item-option")
      .filter({ hasText: needle })
      .first();
    await option.waitFor({ state: "visible", timeout: 10_000 });
    await option.click();
  }
}
