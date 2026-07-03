#!/usr/bin/env node
/**
 * Visual check: meeting/stream tile icons in the Meeting ("Streams") toolbar
 * vs the Depth toolbar. Places a meeting + a jitsi board object via the store,
 * then screenshots both panels.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const STAGE = `/${(process.env.STAGE ?? "touch-draw-test").replace(/^\//, "")}`;
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const SHOT = process.env.SHOT_DIR ?? ".";

const log = (...a) => console.log("[depth-check]", ...a);

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1440, height: 900 },
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();
page.on("pageerror", (e) => log("pageerror:", e.message));

try {
  await page.goto("/login");
  await page.locator('input[name="username"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);

  await page.goto(STAGE);
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__?.stage?.model, null, {
    timeout: 30000,
  });
  await page.waitForFunction(() => !window.__UPSTAGE_PINIA__.stage.preloading, null, {
    timeout: 60000,
  });
  const hero = page.locator("section.hero.cover-image");
  if (await hero.isVisible().catch(() => false)) {
    await hero.click();
    await hero.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  }

  // Place a meeting + a jitsi tile on the board (local-only is fine).
  await page.evaluate(() => {
    const s = window.__UPSTAGE_PINIA__.stage;
    s.placeObjectOnStage({ type: "meeting", name: "helen-room", x: 200, y: 200 });
    s.placeObjectOnStage({ type: "jitsi", name: "solo-stream", x: 350, y: 200 });
  });

  // Meeting ("Streams") toolbar.
  await page.locator('a.panel-block:has(img[src*="meeting.svg"])').first().click();
  await page.waitForTimeout(600);
  await page.locator("#topbar").screenshot({ path: `${SHOT}/panel-streams.png` });

  // Depth toolbar.
  await page.locator('a.panel-block:has(img[src*="depth.svg"])').first().click();
  await page.waitForTimeout(600);
  await page.locator("#topbar").screenshot({ path: `${SHOT}/panel-depth.png` });

  // Dump geometry of icons in the depth panel for diagnosis.
  const geo = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("#topbar .card-content > div").forEach((tile) => {
      tile.querySelectorAll("img").forEach((img) => {
        const ir = img.getBoundingClientRect();
        const tr = tile.getBoundingClientRect();
        out.push({
          src: img.getAttribute("src"),
          img: { w: ir.width, h: ir.height, top: ir.top - tr.top, bottom: tr.bottom - ir.bottom },
          tile: { w: tr.width, h: tr.height },
          clippedBelow: ir.bottom > tr.bottom,
        });
      });
    });
    return out;
  });
  console.log(JSON.stringify(geo, null, 1));
  log("done");
} catch (e) {
  log("ERROR:", e.message);
  await page.screenshot({ path: `${SHOT}/depth-check-error.png` }).catch(() => {});
} finally {
  await browser.close();
}
