#!/usr/bin/env node
/**
 * Context-menu auto-close check for the multiframe "Animation speed" input:
 * committing a value (Enter / blur / spinner) must apply it AND close the
 * menu; live typing must keep the menu open (no close mid-entry).
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const STAGE = `/${(process.env.STAGE ?? "demo").replace(/^\//, "")}`;
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";

const log = (...a) => console.log("[menu-close]", ...a);
let failures = 0;
const check = (ok, label) => {
  console.log(`[menu-close] ${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const page = await (
  await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
).newPage();
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

  // Place a multiframe avatar directly through the store (the demo stage may
  // not carry one); a 1-frame data URI is enough for the menu logic.
  const objId = await page.evaluate(() => {
    const stage = window.__UPSTAGE_PINIA__.stage;
    const px =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const placed = stage.placeObjectOnStage({
      type: "avatar",
      name: "menu-close-check",
      multi: true,
      frames: [px, px],
      src: px,
      x: 400,
      y: 300,
      w: 120,
      h: 120,
    });
    return placed.id;
  });
  const obj = page.locator(`[data-object-id="${objId}"]`).locator("visible=true").first();
  await obj.waitFor({ state: "visible", timeout: 10000 });

  // Hold the avatar (double-click) so the context menu is controlable.
  await obj.dblclick();
  await page.waitForTimeout(400);

  const menu = page.locator("body > .card:has(input.anmation-input)");

  const openMenu = async () => {
    await obj.click({ button: "right" });
    await menu.waitFor({ state: "visible", timeout: 5000 });
  };

  // --- 1. Typing keeps the menu open; Enter commits and closes. ---
  await openMenu();
  const input = menu.locator("input.anmation-input");
  await input.click();
  await input.press("Backspace");
  await page.keyboard.type("2", { delay: 50 });
  await page.waitForTimeout(300);
  check(await menu.isVisible(), "menu stays open while typing");
  await page.keyboard.press("Enter");
  await menu.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  check(!(await menu.isVisible().catch(() => false)), "menu closes on Enter");
  const applied = await page.evaluate(
    (id) => window.__UPSTAGE_PINIA__.stage.board.objects.find((o) => o.id === id)?.autoplayFrames,
    objId,
  );
  check(String(applied) === "2", `speed applied (autoplayFrames=${applied})`);

  // --- 2. Blur (click elsewhere in the menu area) also commits+closes. ---
  await openMenu();
  const input2 = menu.locator("input.anmation-input");
  await input2.click();
  await input2.press("Control+a").catch(() => {});
  await page.keyboard.type("3.5", { delay: 50 });
  // Click the menu's own header area (not a pick) to blur the input.
  await menu.click({ position: { x: 5, y: 5 } });
  await menu.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  check(!(await menu.isVisible().catch(() => false)), "menu closes on blur after typing");
  const applied2 = await page.evaluate(
    (id) => window.__UPSTAGE_PINIA__.stage.board.objects.find((o) => o.id === id)?.autoplayFrames,
    objId,
  );
  check(String(applied2) === "3.5", `blur-committed speed applied (autoplayFrames=${applied2})`);

  // --- 3. Sanity: a normal pick (Flip horizontal) still closes the menu. ---
  await openMenu();
  await menu.locator("button", { hasText: /horizontal/i }).first().click();
  await menu.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  check(!(await menu.isVisible().catch(() => false)), "normal pick still closes menu");

  await page.screenshot({ path: `${SHOT_DIR}/menu-close-final.png` });
} catch (err) {
  log("ERROR:", err?.message ?? err);
  await page.screenshot({ path: `${SHOT_DIR}/menu-close-error.png` }).catch(() => {});
  failures += 1;
} finally {
  // Cleanup the test object.
  await page
    .evaluate(() => {
      const stage = window.__UPSTAGE_PINIA__.stage;
      stage.board.objects
        .filter((o) => o.name === "menu-close-check")
        .forEach((o) => stage.deleteObject(o));
    })
    .catch(() => {});
  await page.waitForTimeout(800).catch(() => {});
  await browser.close();
  console.log(`[menu-close] ${failures ? failures + " FAILURES" : "ALL PASS"}`);
  process.exit(failures ? 1 : 0);
}
