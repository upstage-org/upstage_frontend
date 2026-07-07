#!/usr/bin/env node
/**
 * Touch-input smoke check for the drawing tools (object drawing + whiteboard).
 *
 * Dispatches REAL CDP touch events (touchStart → touchMove* → touchEnd) so the
 * browser's own gesture / touch-action pipeline runs — the same path a tablet
 * touch takes, unlike page.mouse or synthetic dispatchEvent. Verifies:
 *   1. a slow touch swipe paints a LINE on the object-drawing canvas
 *      (regression guard for the "dots, not lines" tablet bug),
 *   2. a fast flick also paints a line,
 *   3. touch-draw → "Save as Prop" places an object on the board,
 *   4. a whiteboard (live drawing) touch stroke round-trips over MQTT as a
 *      multi-segment command.
 *
 * Usage (against an already-running SPA + backend):
 *   node tests/e2e/scripts/touch-draw-check.mjs
 * Env:
 *   TOUCH_BASE_URL   default http://127.0.0.1:3001
 *   TOUCH_STAGE      default touch-draw-test   (stage fileLocation, no slash)
 *   E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD    login (defaults admin / Secret@123)
 *   TOUCH_MAP_HOST   optional "host" to resolve to 127.0.0.1 (test a local
 *                    nginx vhost, e.g. TOUCH_MAP_HOST=dev.upstage.live)
 *
 * Limitations: Chromium emulation only. It cannot reproduce WebKit/iPadOS
 * native-gesture quirks — real-device passes on an iPad are still needed for
 * Safari-specific behaviour (see the stopNativeTouch hardening in
 * src/components/stage/Toolboxs/tools/Draw/composable.ts).
 */
import { chromium } from "@playwright/test";

const BASE = process.env.TOUCH_BASE_URL ?? "http://127.0.0.1:3001";
const STAGE = `/${(process.env.TOUCH_STAGE ?? "touch-draw-test").replace(/^\//, "")}`;
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const MAP_HOST = process.env.TOUCH_MAP_HOST;

const log = (...a) => console.log("[touch-check]", ...a);
let failures = 0;
const check = (ok, label) => {
  console.log(`[touch-check] ${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures += 1;
};

const args = ["--mute-audio"];
if (MAP_HOST) args.push(`--host-resolver-rules=MAP ${MAP_HOST} 127.0.0.1`);

const browser = await chromium.launch({ headless: true, args });
const context = await browser.newContext({
  baseURL: BASE,
  hasTouch: true,
  isMobile: true,
  viewport: { width: 1024, height: 768 },
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();
page.on("pageerror", (e) => log("pageerror:", e.message));

try {
  // --- login ---
  await page.goto("/login");
  await page.locator('input[name="username"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);

  // --- open stage; the __UPSTAGE_PINIA__ dev hook needs DEV or VITE_E2E=1 ---
  await page.goto(STAGE);
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__?.stage?.model, null, {
    timeout: 30000,
  });
  await page.waitForFunction(() => !window.__UPSTAGE_PINIA__.stage.preloading, null, {
    timeout: 60000,
  });

  // Dismiss the "click anywhere to continue" cover overlay if present.
  const hero = page.locator("section.hero.cover-image");
  if (await hero.isVisible().catch(() => false)) {
    await hero.click();
    await hero.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
  }

  // --- open the object-drawing panel (canvas mounts with the panel) ---
  await page.locator('a.panel-block:has(img[src*="object-drawing.svg"])').first().click();
  await page.locator("span.tag", { hasText: "New Drawing" }).first().click();
  const canvas = page.locator("canvas.drawing").first();
  await canvas.waitFor({ state: "visible", timeout: 10000 });
  const box = await canvas.boundingBox();

  const clearPixels = () =>
    page.evaluate(() => {
      const c = document.querySelector("canvas.drawing");
      c.getContext("2d").clearRect(0, 0, c.width, c.height);
    });

  const paintedBBox = () =>
    page.evaluate(() => {
      const c = document.querySelector("canvas.drawing");
      const { width, height } = c;
      const d = c.getContext("2d").getImageData(0, 0, width, height).data;
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity,
        count = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (d[(y * width + x) * 4 + 3] > 0) {
            count++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return count ? { count, w: maxX - minX + 1, h: maxY - minY + 1 } : { count: 0, w: 0, h: 0 };
    });

  // --- real touch swipe via CDP ---
  const cdp = await context.newCDPSession(page);
  const swipe = async (fromX, fromY, toX, toY, steps = 20, stepDelayMs = 15) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: fromX, y: fromY, id: 1 }],
    });
    for (let i = 1; i <= steps; i++) {
      const x = fromX + ((toX - fromX) * i) / steps;
      const y = fromY + ((toY - fromY) * i) / steps;
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y, id: 1 }],
      });
      await new Promise((r) => setTimeout(r, stepDelayMs));
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // 1. slow swipe → line
  await clearPixels();
  await swipe(cx - 150, cy, cx + 150, cy);
  await page.waitForTimeout(300);
  const slow = await paintedBBox();
  check(slow.w >= 250, `slow touch swipe paints a line (painted width ${slow.w}px)`);

  // 2. fast flick → line
  await clearPixels();
  await swipe(cx - 150, cy - 60, cx + 150, cy + 60, 5, 5);
  await page.waitForTimeout(300);
  const fast = await paintedBBox();
  check(fast.w >= 250, `fast touch flick paints a line (painted width ${fast.w}px)`);

  // 3. touch-draw → Save as Prop → board object
  await clearPixels();
  await swipe(cx - 100, cy - 40, cx + 100, cy + 40, 12, 10);
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => window.__UPSTAGE_PINIA__.stage.board.objects.length);
  await page.locator("span.tag", { hasText: "Save as Prop" }).first().click();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__UPSTAGE_PINIA__.stage.board.objects.length);
  check(after > before, `Save as Prop places the drawing on stage (${before} → ${after} objects)`);

  // 4. whiteboard live drawing → MQTT round-trip with a multi-segment stroke
  await page.locator('a.panel-block:has(img[src*="whiteboard.svg"])').first().click();
  const wbCanvas = page.locator("canvas.drawing").first();
  await wbCanvas.waitFor({ state: "visible", timeout: 10000 });
  const wbBox = await wbCanvas.boundingBox();
  const wbBefore = await page.evaluate(
    () => window.__UPSTAGE_PINIA__.stage.whiteboard?.length ?? 0,
  );
  await swipe(
    wbBox.x + wbBox.width / 2 - 120,
    wbBox.y + wbBox.height / 2,
    wbBox.x + wbBox.width / 2 + 120,
    wbBox.y + wbBox.height / 2,
    15,
    10,
  );
  await page.waitForTimeout(1500);
  const wb = await page.evaluate(() => {
    const list = window.__UPSTAGE_PINIA__.stage.whiteboard ?? [];
    const last = list[list.length - 1];
    return { count: list.length, lastLines: last?.lines?.length ?? 0 };
  });
  check(
    wb.count > wbBefore && wb.lastLines >= 5,
    `whiteboard touch stroke round-trips as a line (${wb.lastLines} segments)`,
  );
} finally {
  await browser.close();
}

if (failures) {
  console.error(`[touch-check] ${failures} check(s) FAILED`);
  process.exit(1);
}
log("all checks passed");
