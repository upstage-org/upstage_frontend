#!/usr/bin/env node
// Identify the thin black horizontal bar painted across the RTMP probe tile.
// No publisher needed if the bar shows on the placeholder too; we publish
// nothing and just inspect the DOM at the bar's position.
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3999";
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const page = await browser.newPage({ baseURL: BASE });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

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
      name: "bar-ident",
      fileLocation: "trythis",
      w: 480,
      h: 270,
      x: 340,
      y: 220,
      liveAction: false,
      published: false,
    }).id,
);
// Deselect so overlays tied to selection are gone.
await page.mouse.click(150, 730);
await page.waitForTimeout(1500);

const info = await page.evaluate((id) => {
  const w = document.querySelector(`[data-object-id="${id}"]`).getBoundingClientRect();
  // The bar sat at ~52% height, from ~30% width to the right edge.
  const pts = [
    [w.x + w.width * 0.6, w.y + w.height * 0.52],
    [w.x + w.width * 0.8, w.y + w.height * 0.5],
    [w.x + w.width * 0.5, w.y + w.height * 0.53],
  ];
  const describe = (el) => {
    const chain = [];
    let n = el;
    while (n && chain.length < 8) {
      const cls = typeof n.className === "string" ? n.className : "";
      const cs = getComputedStyle(n);
      chain.push({
        tag: n.tagName,
        cls: cls.slice(0, 60),
        id: n.id || undefined,
        bg: cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : undefined,
        rect: (({ x, y, width, height }) => ({
          x: Math.round(x),
          y: Math.round(y),
          w: Math.round(width),
          h: Math.round(height),
        }))(n.getBoundingClientRect()),
      });
      n = n.parentElement;
    }
    return chain;
  };
  return pts.map(([x, y]) => {
    const stack = document.elementsFromPoint(x, y).slice(0, 6);
    return {
      x: Math.round(x),
      y: Math.round(y),
      top: describe(stack[0]),
      stackTags: stack.map((e) => `${e.tagName}.${(typeof e.className === "string" ? e.className : "").split(" ")[0]}`),
    };
  });
}, id);
console.log(JSON.stringify(info, null, 2));
await page.screenshot({
  path: (process.env.SHOT_DIR ?? ".") + "/bar-ident.png",
});
await browser.close();
