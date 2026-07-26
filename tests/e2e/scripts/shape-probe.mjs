#!/usr/bin/env node
/**
 * RTMP tile frame-shape spot check (2026-07-27): does each shape visibly
 * clip the live <video>? Owner report: every shape works except "rounded".
 *
 * Places an RTMP tile, publishes a bright test feed, clicks shape swatches
 * in the real context menu, then samples corner pixels: a corner point
 * inside the clip radius must show the STAGE BACKGROUND (clipped), for
 * rect it must show video content.
 *
 * Usage: TOKEN=... node tests/e2e/scripts/shape-probe.mjs  (vite :3999)
 */
import { execFile, spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3999";
const STAGE = (process.env.STAGE ?? "touch-draw-test").replace(/^\//, "");
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const KEY = process.env.KEY ?? "trythis";
const TOKEN = process.env.TOKEN ?? "";
const SHOT = process.env.SHOT_DIR ?? ".";
if (!TOKEN) {
  console.error("TOKEN env required");
  process.exit(2);
}
const log = (...a) => console.log("[shape-probe]", ...a);
const RTMP_URL = `rtmp://127.0.0.1:1935/live/${KEY}?token=${TOKEN}`;

// Solid white feed: any non-white corner pixel = clipped (background).
let publisher = null;
function startPublisher() {
  publisher = spawn(
    "docker",
    [
      "exec", "mediamtx_rtmp", "ffmpeg", "-hide_banner", "-loglevel", "error",
      "-re",
      "-f", "lavfi", "-i", "color=c=white:size=640x360:rate=30",
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-c:v", "libx264",
      "-profile:v", "baseline", "-tune", "zerolatency", "-bf", "0", "-g", "60", "-b:v", "800k",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k",
      "-f", "flv", RTMP_URL,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  publisher.on("exit", (c, s) => log(`publisher exited (${c ?? s})`));
}
async function stopPublisher() {
  if (!publisher) return;
  publisher.kill("SIGTERM");
  publisher = null;
  await new Promise((r) => setTimeout(r, 1200));
  await new Promise((r) =>
    execFile("docker", ["exec", "mediamtx_rtmp", "sh", "-c", "pkill -f 'f flv' || true"], r),
  );
}

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on("pageerror", (e) => log("pageerror:", e.message));

async function samplePixels(points) {
  const buf = await page.screenshot();
  const b64 = buf.toString("base64");
  return await page.evaluate(
    async ({ b64, points }) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = `data:image/png;base64,${b64}`;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return points.map(({ x, y }) => {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return [d[0], d[1], d[2]];
      });
    },
    { b64, points },
  );
}
const isWhite = ([r, g, b]) => r > 225 && g > 225 && b > 225;

try {
  await page.goto("/login");
  await page.locator('input[name="username"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
  log("logged in");
  await page.goto(`/${STAGE}`);
  await page.waitForFunction(
    () => window.__UPSTAGE_PINIA__?.stage?.model && !window.__UPSTAGE_PINIA__.stage.preloading,
    null,
    { timeout: 60_000 },
  );
  const hero = page.locator("section.hero.cover-image");
  if (await hero.isVisible().catch(() => false)) {
    await hero.click();
    await hero.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
  }
  const objectId = await page.evaluate((key) => {
    const placed = window.__UPSTAGE_PINIA__.stage.placeObjectOnStage({
      type: "video",
      isRTMP: true,
      name: "shape-probe-tile",
      fileLocation: key,
      w: 480,
      h: 270,
      x: 340,
      y: 220,
      liveAction: false,
      published: false,
    });
    return placed.id;
  }, KEY);
  log("tile placed:", objectId);
  startPublisher();
  const live = await page
    .waitForFunction(
      (id) => {
        const el = document.getElementById(`video${id}`);
        return el && el.videoWidth > 0 && el.readyState >= 2 && !el.paused;
      },
      objectId,
      { timeout: 60_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!live) throw new Error("tile never played");
  await page.waitForTimeout(5000);

  const wrapper = page.locator(`[data-object-id="${objectId}"]`);
  for (const shape of ["rect", "rounded", "circle", "rounded", "diamond"]) {
    // Right-click near the tile CENTRE: with a clip-path shape active the
    // corners aren't hittable (clicks fall through the clipped region).
    await wrapper.click({ button: "right", position: { x: 240, y: 100 }, force: true });
    const btn = page.locator(`[data-testid="shape-${shape}"]`);
    await btn.waitFor({ state: "visible", timeout: 10_000 });
    // force: the selected tile's raised wrapper overlaps the popup in the
    // hit-test; the handler is on the button itself either way.
    await btn.click({ force: true });
    const close = page.locator('[data-testid="close-context-menu"]');
    if (await close.isVisible().catch(() => false)) await close.click({ force: true });
    // Deselect (click empty board) so the green Moveable frame, corner
    // handles and slider overlay don't pollute the pixel samples.
    await page.mouse.click(150, 730);
    await page.waitForTimeout(500);

    const info = await page.evaluate((id) => {
      const wrapper = document.querySelector(`[data-object-id="${id}"]`);
      const obj = window.__UPSTAGE_PINIA__.stage.board.objects.find((o) => o.id === id);
      const cs = getComputedStyle(wrapper);
      const r = wrapper.getBoundingClientRect();
      return {
        storeShape: obj?.shape ?? null,
        borderRadius: cs.borderRadius,
        clipPath: cs.clipPath,
        overflow: cs.overflow,
        box: { x: r.x, y: r.y, w: r.width, h: r.height },
      };
    }, objectId);
    const b = info.box;
    // Corner probes: (2,2) is outside a 12px-radius arc; center is control.
    const pts = [
      { x: b.x + 2, y: b.y + 2 },
      { x: b.x + b.w - 2, y: b.y + 2 },
      { x: b.x + 2, y: b.y + b.h - 2 },
      { x: b.x + b.w - 2, y: b.y + b.h - 2 },
      { x: b.x + b.w / 2, y: b.y + b.h / 2 },
    ];
    const px = await samplePixels(pts);
    const corners = px.slice(0, 4).map(isWhite);
    const center = isWhite(px[4]);
    await page.screenshot({
      path: `${SHOT}/shape-${shape}.png`,
      clip: { x: b.x - 15, y: b.y - 15, width: b.w + 30, height: b.h + 30 },
    });
    log(
      `shape=${shape}: store=${info.storeShape} borderRadius=${info.borderRadius} clipPath=${info.clipPath} ` +
        `cornersShowVideo=${JSON.stringify(corners)} centerShowsVideo=${center} px=${JSON.stringify(px)}`,
    );
  }
  // --- jitsi wiring check (no conference needed): a trackless jitsi tile
  // shares the same .object wrapper + frameStyle path, so verifying the
  // stored shape reaches computed border-radius covers the jitsi side; the
  // does-border-radius-clip-live-video question is answered by the RTMP
  // white-feed measurement above (identical DOM/CSS structure).
  const jitsiId = await page.evaluate(() => {
    const placed = window.__UPSTAGE_PINIA__.stage.placeObjectOnStage({
      type: "jitsi",
      name: "shape-probe-jitsi",
      w: 480,
      h: 270,
      x: 340,
      y: 220,
      liveAction: false,
      published: false,
    });
    return placed.id;
  });
  log("jitsi tile placed:", jitsiId);
  await page.waitForTimeout(1000);
  for (const shape of [null, "rect", "rounded", "circle"]) {
    if (shape) {
      await page.evaluate(
        ({ id, shape }) => {
          const store = window.__UPSTAGE_PINIA__.stage;
          const obj = store.board.objects.find((o) => o.id === id);
          store.shapeObject({ ...obj, shape });
        },
        { id: jitsiId, shape },
      );
      await page.waitForTimeout(400);
    }
    const info = await page.evaluate((id) => {
      const wrapper = document.querySelector(`[data-object-id="${id}"]`);
      const obj = window.__UPSTAGE_PINIA__.stage.board.objects.find((o) => o.id === id);
      const cs = getComputedStyle(wrapper);
      return {
        storeShape: obj?.shape ?? null,
        borderRadius: cs.borderRadius,
        clipPath: cs.clipPath,
        overflow: cs.overflow,
      };
    }, jitsiId);
    log(`jitsi shape=${shape ?? "(default)"}:`, JSON.stringify(info));
  }
} finally {
  await stopPublisher();
  await browser.close();
}
