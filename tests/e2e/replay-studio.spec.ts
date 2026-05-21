import { expect, test } from "@playwright/test";

import { loadE2eConfig } from "./e2e-config";
import { readRuntimeOptional } from "./fixtures/runtime";
import { LoginPage } from "./pages/LoginPage";
import { StageManagementPage } from "./pages/StageManagementPage";

/**
 * Studio → Archive → replay viewer (same path operators use in production).
 * Requires `pnpm e2e:setup` (runtime.json) and at least one archived performance.
 */
test.describe("Studio replay entry @replay-studio", () => {
  test("Archive tab navigates to replay viewer with controls", async ({ page }) => {
    const runtime = readRuntimeOptional();
    test.skip(!runtime, "runtime.json missing — run pnpm e2e:setup first");

    const cfg = loadE2eConfig();
    await new LoginPage(page).login(cfg.adminUsername, cfg.adminPassword);

    await page.goto(`/stages/stage-management/${runtime!.stageId}`);
    await new StageManagementPage(page).openArchiveTab();

    const replayLink = page.locator(`a[href^="/replay/${runtime!.stageSlug}/"]`).first();
    await expect(replayLink).toBeVisible({ timeout: 60_000 });
    const href = await replayLink.getAttribute("href");
    expect(href).toMatch(new RegExp(`^/replay/${runtime!.stageSlug}/\\d+$`));

    await replayLink.click();
    await page.waitForURL(new RegExp(`/replay/${runtime!.stageSlug}/\\d+`), {
      timeout: 60_000,
    });

    const hero = page.locator("section.hero.is-fullheight").first();
    await hero.waitFor({ state: "visible", timeout: 60_000 });
    const continueText = page.getByText(/click anywhere to continue/i).first();
    if (await continueText.isVisible().catch(() => false)) {
      await hero.click();
    }

    await expect(page.locator("#replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#replay-controls .fa-play").first()).toBeVisible();
    await expect(page.getByText(/replaying/i).first()).toBeVisible();
  });
});
