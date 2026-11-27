import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { loadE2eConfig } from "./e2e-config";
import { readRuntimeOptional } from "./fixtures/runtime";
import { LiveStagePage } from "./pages/LiveStagePage";
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

/**
 * #1567: chat timestamps in the Archive tab. Once a stage is swept its chat
 * lives in Stage Management → Archive, so that is where "with or without
 * timestamps" is chosen — one switch for viewing and for downloading.
 *
 * The test makes its own archived performance: it chats on the live stage,
 * then archives it from the Archive tab. Archived chat comes from the event
 * archive, so the e2e archive worker must be running:
 *
 *   tests/e2e/env/e2e-archive-up.sh
 *   E2E_EVENT_ARCHIVE=1 pnpm exec playwright test --project=replay-studio -g "chat timestamps"
 *   docker rm -f upstage_event_archive_e2e
 */
test.describe("Studio archive chat timestamps @replay-studio", () => {
  test("Archive tab: the Include timestamps switch governs the transcript and the download", async ({
    page,
  }) => {
    test.skip(
      process.env.E2E_EVENT_ARCHIVE !== "1",
      "E2E_EVENT_ARCHIVE=1 required (an event-archive worker for the e2e database)",
    );
    const runtime = readRuntimeOptional();
    test.skip(!runtime, "runtime.json missing — run pnpm e2e:setup first");
    test.setTimeout(180_000);

    const cfg = loadE2eConfig();
    const tag = Date.now().toString(36);
    const publicLine = `hello from the stage ${tag}`;
    const secondLine = `second line ${tag}`;
    const privateLine = `backstage ${tag}`;

    await new LoginPage(page).login(cfg.adminUsername, cfg.adminPassword);

    // ---- Chat on the live stage: two audience-visible lines, one player-only.
    await new LiveStagePage(page).goto(runtime!.stageSlug);
    await page.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
      timeout: 30_000,
    });
    const before = Date.now();
    await page.evaluate(
      async ({ lines, privateText }) => {
        const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
          sendChat: (m: { message: string; isPrivate?: boolean }) => unknown;
        };
        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        for (const message of lines) {
          stage.sendChat({ message });
          await sleep(1100); // distinct seconds, so the stamps differ
        }
        stage.sendChat({ message: privateText, isPrivate: true });
        await sleep(1500); // let the archive worker store them
      },
      { lines: [publicLine, secondLine], privateText: privateLine },
    );
    const after = Date.now();

    // ---- Archive the performance from Stage Management.
    await page.goto(`/stages/stage-management/${runtime!.stageId}`);
    await new StageManagementPage(page).openArchiveTab();
    await page.getByRole("button", { name: "Archive Performance" }).click();
    await page.locator(".ant-modal-confirm .ant-btn-dangerous").click();

    // The new performance is the first row; wait for our chat to be in it.
    const row = page.locator("table tbody tr").first();
    const viewAudience = row.locator("td.public-chat button").first();
    const downloadAudience = row.locator("td.public-chat button").nth(1);
    const viewPlayer = row.locator("td.private-chat button").first();
    const downloadPlayer = row.locator("td.private-chat button").nth(1);
    await expect(viewAudience).toBeVisible({ timeout: 60_000 });

    const toggle = page.locator(".archive-chat-timestamps label");
    const toggleInput = page.locator('input[data-testid="archive-chat-timestamps"]');
    await expect(toggle).toBeVisible();
    await expect(page.locator(".archive-chat-timestamps")).toContainText("Include timestamps");
    await expect(toggleInput).not.toBeChecked();

    const downloaded = async (button: typeof downloadAudience) => {
      const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
      const file = await download.path();
      return { name: download.suggestedFilename(), text: readFileSync(file, "utf8") };
    };
    const STAMP = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] /;
    const linesOf = (text: string) => text.split("\r\n").filter(Boolean);
    const openTranscript = async (button: typeof viewAudience) => {
      await button.click();
      const modal = page.locator(".modal.is-active").last();
      await expect(modal).toBeVisible();
      return modal;
    };
    const closeTranscript = async () => {
      await page.locator(".modal.is-active").last().locator("button.delete").click();
      await expect(page.locator(".modal.is-active")).toHaveCount(0);
    };

    // ---- Switch OFF (default): the plain log and a transcript without times.
    const plain = await downloaded(downloadAudience);
    expect(plain.name).toMatch(/-Audience-chat-\d{4}-\d{8}\.txt$/);
    const plainLines = linesOf(plain.text);
    expect(plainLines.some((l) => l.endsWith(`: ${publicLine}`))).toBe(true);
    expect(plainLines.some((l) => l.endsWith(`: ${secondLine}`))).toBe(true);
    expect(plainLines.some((l) => l.includes(privateLine))).toBe(false);
    for (const line of plainLines) expect(line).not.toMatch(STAMP);

    let modal = await openTranscript(viewAudience);
    await expect(modal).toContainText(publicLine);
    await expect(modal.locator("[data-testid=chat-time]")).toHaveCount(0);
    await closeTranscript();

    // ---- Switch ON: every line carries its date and time, in both places.
    await toggle.click();
    await expect(toggleInput).toBeChecked();

    const stamped = await downloaded(downloadAudience);
    expect(stamped.name).toBe(plain.name);
    const stampedLines = linesOf(stamped.text);
    expect(stampedLines.length).toBe(plainLines.length);
    const ours = stampedLines.filter((l) => l.includes(tag));
    expect(ours).toHaveLength(2);
    const times = ours.map((line) => {
      const match = line.match(STAMP);
      expect(match, line).not.toBeNull();
      return new Date(match![1].replace(" ", "T")).getTime();
    });
    // The stamps are when the lines were sent (to the second), in order.
    for (const time of times) {
      expect(time).toBeGreaterThanOrEqual(before - 2_000);
      expect(time).toBeLessThanOrEqual(after + 2_000);
    }
    expect(times[1]).toBeGreaterThan(times[0]);
    // Without the stamps it is the same log as before, line for line.
    expect(stampedLines.map((l) => l.replace(STAMP, ""))).toEqual(plainLines);

    modal = await openTranscript(viewAudience);
    const shownTimes = await modal.locator("[data-testid=chat-time]").allTextContents();
    expect(shownTimes.length).toBeGreaterThanOrEqual(2);
    for (const shown of shownTimes) expect(shown).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    await expect(modal).toContainText(secondLine);
    await closeTranscript();

    // ---- The player chat follows the same switch.
    const playerLog = await downloaded(downloadPlayer);
    expect(playerLog.name).toMatch(/-Player-chat-\d{4}-\d{8}\.txt$/);
    const playerLines = linesOf(playerLog.text).filter((l) => l.includes(tag));
    expect(playerLines).toHaveLength(1);
    expect(playerLines[0]).toMatch(STAMP);
    expect(playerLines[0].endsWith(`: ${privateLine}`)).toBe(true);
    modal = await openTranscript(viewPlayer);
    await expect(modal).toContainText(privateLine);
    await expect(modal.locator("[data-testid=chat-time]").first()).toBeVisible();
    await closeTranscript();

    // ---- "Download all" too.
    const [allDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download All Audience Chat" }).click(),
    ]);
    const allText = readFileSync(await allDownload.path(), "utf8");
    expect(
      linesOf(allText)
        .filter((l) => l.includes(tag))
        .every((l) => STAMP.test(l)),
    ).toBe(true);

    // ---- The choice is remembered when the page is opened again.
    // (A reload stays on the Archive tab's own address.)
    await page.reload();
    await expect(page.locator('input[data-testid="archive-chat-timestamps"]')).toBeChecked({
      timeout: 30_000,
    });
    await page.locator(".archive-chat-timestamps label").click();
    await expect(page.locator('input[data-testid="archive-chat-timestamps"]')).not.toBeChecked();
  });
});
