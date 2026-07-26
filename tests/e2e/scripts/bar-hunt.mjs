#!/usr/bin/env node
// Find which element paints the black bar across the RTMP tile:
// enumerate elements intersecting the bar region, then hide suspects one
// by one and re-screenshot until the bar disappears.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3999";
const SHOT = process.env.SHOT_DIR ?? ".";
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const page = await browser.newPage({ baseURL: BASE });

await page.goto("/login");
await page.locator('input[name="username"]').first().fill(process.env.E2E_ADMIN_USERNAME ?? "admin");
await page.locator('input[type="password"]').first().fill(process.env.E2E_ADMIN_PASSWORD ?? "Secret@123");
await Promise.all([
  page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 }),
  page.locator('button[type="submit"]').first().click(),
]);
await page.goto("/touch-draw-test");
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
const id = await page.evaluate(
  () =>
    window.__UPSTAGE_PINIA__.stage.placeObjectOnStage({
      type: "video",
      isRTMP: true,
      name: "bar-hunt",
      fileLocation: "trythis",
      w: 480,
      h: 270,
      x: 340,
      y: 220,
      liveAction: false,
      published: false,
    }).id,
);
await page.mouse.click(150, 730);
await page.waitForTimeout(1500);

// 1) Everything overlapping the bar region (thin: height < 30, wide: > 100).
const candidates = await page.evaluate(() => {
  const hits = [];
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.height < 30 && r.width > 100 && r.y > 340 && r.y < 380 && r.x > 400 && r.x < 850) {
      const cs = getComputedStyle(el);
      hits.push({
        tag: el.tagName,
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 60),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        bg: cs.backgroundColor,
        color: cs.color,
        text: (el.textContent || "").trim().slice(0, 40),
      });
    }
  }
  return hits;
});
console.log("candidates:", JSON.stringify(candidates, null, 2));

// 2) Pixel check helper: is the bar (pure black run) present at y=360?
const barPresent = async () => {
  const buf = await page.screenshot();
  const b64 = buf.toString("base64");
  return await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = `data:image/png;base64,${b64}`;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const row = ctx.getImageData(400, 358, 420, 1).data;
    let black = 0;
    for (let i = 0; i < row.length; i += 4) {
      if (row[i] < 15 && row[i + 1] < 15 && row[i + 2] < 15) black++;
    }
    return black; // count of near-black pixels across the row
  }, b64);
};
console.log("bar black px (baseline):", await barPresent());

// 3) Hide suspects one at a time.
const suspects = [
  ["placeholder span", `document.querySelector('.live-stream-placeholder span')`],
  ["placeholder whole", `document.querySelector('.live-stream-placeholder')`],
  ["video element", `document.getElementById('video${id}')`],
];
for (const [label, expr] of suspects) {
  await page.evaluate(`(() => { const el = ${expr}; if (el) el.style.visibility = 'hidden'; })()`);
  await page.waitForTimeout(300);
  console.log(`after hiding ${label}:`, await barPresent());
  await page.evaluate(`(() => { const el = ${expr}; if (el) el.style.visibility = ''; })()`);
  await page.waitForTimeout(200);
}
await page.screenshot({ path: `${SHOT}/bar-hunt.png` });
await browser.close();
