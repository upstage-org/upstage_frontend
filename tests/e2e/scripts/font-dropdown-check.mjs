#!/usr/bin/env node
/**
 * Font-dropdown smoke check for the on-stage Text tool.
 * Verifies: dropdown opens, options are visible (not clipped), a font can
 * be selected, and the loaded webfonts actually render.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const STAGE = `/${(process.env.STAGE ?? "touch-draw-test").replace(/^\//, "")}`;
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const SHOT = process.env.SHOT_DIR ?? ".";

const log = (...a) => console.log("[font-check]", ...a);
let failures = 0;
const check = (ok, label) => {
  console.log(`[font-check] ${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures += 1;
};

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

  // Open the Text tool panel, then enter writing mode ("New text").
  await page.locator('a.panel-block:has(img[src*="text.svg"])').first().click();
  await page.locator("#topbar span.tag", { hasText: /new text/i }).first().click();

  const dropdown = page.locator("#topbar .font-dropdown").first();
  await dropdown.waitFor({ state: "visible", timeout: 10000 });

  // 1. Click the trigger — menu must become active AND visibly painted.
  await dropdown.locator(".dropdown-trigger button").click();
  const isActive = await dropdown.evaluate((el) => el.classList.contains("is-active"));
  check(isActive, "dropdown toggles is-active on click");

  const menu = dropdown.locator(".dropdown-menu");
  const menuBox = await menu.boundingBox();
  check(!!menuBox && menuBox.height > 100, `menu is visibly painted (box=${JSON.stringify(menuBox)})`);

  // 2. Options: count and confirm not clipped by any overflow ancestor.
  const optCount = await dropdown.locator(".dropdown-item").count();
  check(optCount >= 80, `option count ${optCount} >= 80`);

  const clipped = await dropdown.evaluate((el) => {
    const item = el.querySelector(".dropdown-item");
    const r = item.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !item.contains(hit) && !hit?.contains(item) ? hit?.className ?? "none" : null;
  });
  check(clipped === null, `first option is hit-testable (blocker: ${clipped})`);

  await page.screenshot({ path: `${SHOT}/font-dropdown-open.png` });

  // 3. Select a font from the new batch.
  await dropdown.locator(".dropdown-item", { hasText: "Bangers" }).first().click();
  const selected = await page.evaluate(
    () => window.__UPSTAGE_PINIA__.stage.preferences.text.fontFamily,
  );
  check(selected === "Bangers", `selection updates store fontFamily (got: ${selected})`);

  const applied = await page.evaluate(() => {
    const p = document.querySelector("section.writing > p");
    return getComputedStyle(p).fontFamily;
  });
  check(/bangers/i.test(applied), `writing area uses selected font (got: ${applied})`);

  // 4. The webfont actually loaded (not a fallback render).
  const loaded = await page.evaluate(async () => {
    await document.fonts.load('16px "Bangers"');
    return document.fonts.check('16px "Bangers"');
  });
  check(loaded, "Bangers webfont file loaded from Google Fonts");

  // Spot-check a few more new families resolve.
  const extra = await page.evaluate(async () => {
    const fams = ["Montserrat", "Merriweather", "Caveat", "Press Start 2P", "EB Garamond"];
    const out = {};
    for (const f of fams) {
      await document.fonts.load(`16px "${f}"`);
      out[f] = document.fonts.check(`16px "${f}"`);
    }
    return out;
  });
  for (const [f, ok] of Object.entries(extra)) check(ok, `webfont loads: ${f}`);

  await page.screenshot({ path: `${SHOT}/font-selected.png` });

  // 5. Regression guard: other text-tool controls still work after fix.
  await page.locator("#topbar .text-tool", { hasText: /bold/i }).first().click();
  const bold = await page.evaluate(
    () => window.__UPSTAGE_PINIA__.stage.preferences.text.fontWeight,
  );
  check(bold === "bold", "Bold toggle still works");
  await page.locator("#topbar .text-tool", { hasText: /cancel/i }).first().click();
  const writing = await page.evaluate(
    () => window.__UPSTAGE_PINIA__.stage.preferences.isWriting,
  );
  check(writing === false, "Cancel still exits writing mode");
} catch (e) {
  failures += 1;
  log("ERROR:", e.message);
  await page.screenshot({ path: `${SHOT}/font-check-error.png` }).catch(() => {});
} finally {
  await browser.close();
  log(failures ? `${failures} FAILURE(S)` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}
