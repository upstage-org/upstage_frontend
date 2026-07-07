#!/usr/bin/env node
/**
 * End-to-end check for stage recording initial-state capture.
 *
 * Scenario A (clear OFF): set a backdrop colour + place a live text object,
 * record a few seconds, save, then open the replay — the replay must OPEN
 * with that colour and object visible (previously it always began blank).
 *
 * Scenario B (clear ON): same setup, but the live stage must actually clear
 * at recording start and the replay must open blank.
 *
 * Needs the dev backend + MQTT reachable (same setup as touch-draw-check).
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const STAGE = (process.env.STAGE ?? "touch-draw-test").replace(/^\//, "");
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const SHOT = process.env.SHOT_DIR ?? ".";
const COLOR = "#8800aa"; // distinctive purple

const log = (...a) => console.log("[rec-check]", ...a);
let failures = 0;
const check = (ok, label) => {
  console.log(`[rec-check] ${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();
page.on("pageerror", (e) => log("pageerror:", e.message));

const openStage = async () => {
  await page.goto(`/${STAGE}`);
  await page.waitForFunction(
    () => window.__UPSTAGE_PINIA__?.stage?.model && !window.__UPSTAGE_PINIA__.stage.preloading,
    null,
    { timeout: 60000 },
  );
  const hero = page.locator("section.hero.cover-image");
  if (await hero.isVisible().catch(() => false)) {
    await hero.click();
    await hero.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  }
  // Wait for the MQTT connection so broadcasts go out.
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__.stage.status === "LIVE", null, {
    timeout: 30000,
  });
};

const stageState = () =>
  page.evaluate(() => {
    const s = window.__UPSTAGE_PINIA__.stage;
    return {
      backdropColor: s.backdropColor,
      objects: s.board.objects.length,
      texts: s.board.texts?.length ?? 0,
    };
  });

const startRecording = async (name, clearOnStart) => {
  await page.locator("button.record-icon").click();
  await page.waitForTimeout(300);
  // Name field: the only visible text input in the confirm popover.
  await page.locator('input[type="text"]:visible').last().fill(name);
  // The switch defaults ON; toggle by clicking its label when needed.
  if (!clearOnStart) {
    await page.locator("label.clickable:visible").last().click();
  }
  await page.waitForTimeout(200);
  // Confirm (SaveButton with the video icon).
  await page.locator("button:has(i.fa-video):visible").last().click();
  // Recording active once the stop control appears.
  await page.locator(".recording-control").waitFor({ state: "visible", timeout: 30000 });
};

const saveRecording = async () => {
  await page.locator(".recording-control button").first().click();
  await page.locator("button.record-icon").waitFor({ state: "visible", timeout: 30000 });
  // Fetch the newest performance id from the reloaded model.
  return page.evaluate(() => {
    const perfs = window.__UPSTAGE_PINIA__.stage.model?.performances ?? [];
    const done = perfs.filter((p) => !p.recording);
    return done.length ? done[done.length - 1].id : null;
  });
};

const openReplay = async (id) => {
  await page.goto(`/replay/${STAGE}/${id}`);
  await page.waitForFunction(
    () => window.__UPSTAGE_PINIA__?.stage?.model && !window.__UPSTAGE_PINIA__.stage.preloading,
    null,
    { timeout: 60000 },
  );
  // Dismiss the cover overlay, then press play.
  const cover = page.locator("section.hero.cover-image");
  if (await cover.isVisible().catch(() => false)) {
    await cover.click();
    await cover.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  }
  await page.locator(".fa-play").first().click();
  await page.waitForTimeout(2500); // let the first events apply
};

try {
  await page.goto("/login");
  await page.locator('input[name="username"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);

  // ---------- Scenario A: clear OFF — replay opens with pre-set stage ----------
  await openStage();
  await page.evaluate((color) => {
    const s = window.__UPSTAGE_PINIA__.stage;
    s.setBackdropColor(color);
    s.placeObjectOnStage({
      type: "prop",
      name: "rec-check-prop",
      src: "/icons/stream.svg",
      liveAction: true,
      x: 220,
      y: 160,
      w: 120,
      h: 120,
    });
  }, COLOR);
  await page.waitForTimeout(1500); // let broadcasts echo + archive
  let live = await stageState();
  log("live state before recording:", JSON.stringify(live));

  await startRecording(`snapshot-A-${Math.random().toString(36).slice(2, 7)}`, false);
  await page.waitForTimeout(4000); // record ~4s of "nothing"
  const idA = await saveRecording();
  check(!!idA, `scenario A recording saved (id=${idA})`);

  await openReplay(idA);
  const replayA = await stageState();
  log("replay A opening state:", JSON.stringify(replayA));
  check(
    replayA.backdropColor === COLOR,
    `replay A opens with backdrop ${COLOR} (got ${replayA.backdropColor})`,
  );
  check(replayA.objects >= 1, `replay A opens with the pre-set object (got ${replayA.objects})`);
  await page.screenshot({ path: `${SHOT}/replay-A-open.png` });

  // ---------- Scenario B: clear ON — live clears, replay opens blank ----------
  await openStage();
  await page.evaluate((color) => {
    const s = window.__UPSTAGE_PINIA__.stage;
    s.setBackdropColor(color);
    const placed = s.placeObjectOnStage({
      type: "prop",
      name: "rec-check-prop-b",
      src: "/icons/stream.svg",
      liveAction: true,
      x: 260,
      y: 200,
      w: 100,
      h: 100,
    });
    // Broadcast it for real so it lands in the event archive — the
    // clear-on-start rebuild race is only observable with archived state.
    s.shapeObject({ ...placed, liveAction: true });
  }, COLOR);
  await page.waitForTimeout(1500);

  await startRecording(`snapshot-B-${Math.random().toString(36).slice(2, 7)}`, true);
  await page.waitForTimeout(4000);
  live = await stageState();
  log("live state during clear-on-start recording:", JSON.stringify(live));
  check(
    live.objects === 0,
    `clear-on-start actually cleared the live board (got ${live.objects} objects)`,
  );
  check(live.backdropColor !== COLOR, `clear-on-start reset backdrop (got ${live.backdropColor})`);
  const idB = await saveRecording();
  check(!!idB && idB !== idA, `scenario B recording saved (id=${idB})`);

  await openReplay(idB);
  const replayB = await stageState();
  log("replay B opening state:", JSON.stringify(replayB));
  check(replayB.objects === 0, `replay B opens blank (got ${replayB.objects} objects)`);
  check(
    replayB.backdropColor !== COLOR,
    `replay B opens without the purple backdrop (got ${replayB.backdropColor})`,
  );
  await page.screenshot({ path: `${SHOT}/replay-B-open.png` });
} catch (e) {
  failures += 1;
  log("ERROR:", e.message);
  await page.screenshot({ path: `${SHOT}/rec-check-error.png` }).catch(() => {});
} finally {
  await browser.close();
  log(failures ? `${failures} FAILURE(S)` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}
