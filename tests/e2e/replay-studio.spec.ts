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

    // The curtain only: once it leaves, #live-stage is a `section.hero.is-fullheight` too.
    const hero = page.locator("section.hero.cover-image").first();
    await hero.waitFor({ state: "visible", timeout: 60_000 });
    // The curtain reads "Preloading media…" first; wait for the invitation, then click.
    const continueText = page.getByText(/click anywhere to continue/i).first();
    await continueText.waitFor({ state: "visible", timeout: 60_000 });
    await hero.click();
    await expect(hero).toBeHidden({ timeout: 10_000 });

    await expect(page.locator("#replay-controls")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#replay-controls .fa-play").first()).toBeVisible();
    await expect(page.getByText(/replaying/i).first()).toBeVisible();

    // #1574: pressing Play used to draw the loading curtain again, and no click
    // could dismiss it. The recording must keep playing with the stage visible.
    await page.locator("#replay-controls .fa-play").first().click();
    await expect(page.locator("#replay-controls .fa-pause").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(hero).toBeHidden({ timeout: 10_000 });
    await expect(page.locator("#replay-controls")).toBeVisible();
  });
});
