#!/usr/bin/env node
/**
 * RTMP tile Fit/Crop/Stretch verification probe (2026-07-27).
 *
 * Owner report: OBS feed sits in the upper-left of the tile, not filling
 * the allocated frame; asked to verify crop (cover) and stretch (fill)
 * actually work.
 *
 * Scenario A ("aspect-4x3"): clean 640x480 feed into a 480x270 (16:9)
 * tile. Cycles fit modes through the REAL context-menu buttons
 * (data-testid fit-contain / fit-cover / fit-fill) and measures:
 *   - stored object.fit in the pinia store,
 *   - computed object-fit on the <video>,
 *   - video box vs wrapper box,
 *   - painted pixels in the left/right pillarbox bands vs the page
 *     background (contain => bands = background; cover/fill => content).
 *
 * Scenario B ("obs-canvas-topleft"): 960x540 content padded onto a
 * 1920x1080 black canvas at (0,0) — the classic OBS "source smaller than
 * canvas, anchored top-left" misconfig. Even at fit=fill the right/bottom
 * of the tile must paint BLACK (it IS part of the encoded frame), which
 * reproduces the owner's symptom without any frontend bug.
 *
 * Usage: TOKEN=... node fit-mode-probe.mjs   (vite on :3999, dev backend)
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
  console.error("TOKEN env is required");
  process.exit(2);
}

const log = (...a) => console.log("[fit-probe]", ...a);
const RTMP_URL = `rtmp://127.0.0.1:1935/live/${KEY}?token=${TOKEN}`;

const SCENARIOS = [
  {
    name: "aspect-4x3 (640x480 into 480x270 tile)",
    slug: "aspect43",
    inputSize: "640x480",
    vf: null,
    tile: { w: 480, h: 270, x: 340, y: 220 },
    fits: ["contain", "cover", "fill", "contain"], // end back on contain: A/B repeatability
  },
  {
    name: "obs-canvas-topleft (960x540 content on 1920x1080 black canvas)",
    slug: "obstopleft",
    inputSize: "960x540",
    vf: "pad=1920:1080:0:0:black",
    tile: { w: 480, h: 270, x: 340, y: 220 },
    fits: ["contain", "cover", "fill"],
  },
];

let publisher = null;
function startPublisher(s) {
  const args = [
    "exec", "mediamtx_rtmp", "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-re",
    "-f", "lavfi", "-i", `testsrc2=size=${s.inputSize}:rate=30`,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    ...(s.vf ? ["-vf", s.vf] : []),
    "-c:v", "libx264",
    "-profile:v", "baseline", "-tune", "zerolatency", "-bf", "0", "-g", "60", "-b:v", "1500k",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k",
    "-f", "flv", RTMP_URL,
  ];
  log(`publisher up: ${s.name}`);
  publisher = spawn("docker", args, { stdio: ["ignore", "inherit", "inherit"] });
  publisher.on("exit", (code, sig) => log(`publisher exited (${code ?? sig})`));
}
async function stopPublisher() {
  if (!publisher) return;
  const p = publisher;
  publisher = null;
  p.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  await new Promise((r) =>
    execFile("docker", ["exec", "mediamtx_rtmp", "sh", "-c", "pkill -f 'f flv' || true"], r),
  );
  log("publisher stopped");
}

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on("pageerror", (e) => log("pageerror:", e.message));
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("[stage] live stream")) log("app:", t);
});

async function openStageAndPlaceTile(tile) {
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
  // Local-only, unpublished: nothing broadcast.
  return await page.evaluate(
    ({ key, tile }) => {
      const placed = window.__UPSTAGE_PINIA__.stage.placeObjectOnStage({
        type: "video",
        isRTMP: true,
        name: "fit-probe-tile",
        fileLocation: key,
        w: tile.w,
        h: tile.h,
        x: tile.x,
        y: tile.y,
        liveAction: false,
        published: false,
      });
      return placed.id;
    },
    { key: KEY, tile },
  );
}

async function setFitViaMenu(objectId, fit) {
  const wrapper = page.locator(`[data-object-id="${objectId}"]`);
  // Open the real context menu on the tile.
  await wrapper.click({ button: "right", position: { x: 30, y: 30 } });
  const btn = page.locator(`[data-testid="fit-${fit}"]`);
  await btn.waitFor({ state: "visible", timeout: 10_000 });
  await btn.click();
  // Close the menu (it stays open by design) so it can't overlap the tile.
  const close = page.locator('[data-testid="close-context-menu"]');
  if (await close.isVisible().catch(() => false)) await close.click();
  await page.waitForTimeout(600);
}

async function sampleGeometry(objectId) {
  return await page.evaluate((id) => {
    const el = document.getElementById(`video${id}`);
    const wrapper = document.querySelector(`[data-object-id="${id}"]`);
    if (!el || !wrapper) return { error: "missing elements" };
    const store = window.__UPSTAGE_PINIA__.stage;
    const obj = store.board.objects.find((o) => o.id === id);
    const style = getComputedStyle(el);
    const wStyle = getComputedStyle(wrapper);
    const vr = el.getBoundingClientRect();
    const wr = wrapper.getBoundingClientRect();
    return {
      storeFit: obj ? (obj.fit ?? null) : "OBJECT-GONE",
      cssVar: wStyle.getPropertyValue("--stream-fit").trim(),
      computedObjectFit: style.objectFit,
      objectPosition: style.objectPosition,
      path: el.srcObject ? "WHEP" : el.src?.startsWith("blob:") ? "HLS(hls.js)" : el.src ? "HLS(native)" : "none",
      intrinsic: { w: el.videoWidth, h: el.videoHeight },
      paused: el.paused,
      videoBox: { x: vr.x, y: vr.y, w: vr.width, h: vr.height },
      wrapperBox: { x: wr.x, y: wr.y, w: wr.width, h: wr.height },
    };
  }, objectId);
}

/**
 * Screenshot the viewport, hand the PNG back to the page, decode it on a
 * canvas, and sample the requested viewport points. Returns [{x,y,r,g,b}].
 */
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
      // Screenshot pixels are CSS px * DPR; viewport DPR is 1 here.
      return points.map(({ x, y }) => {
        const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        return { x, y, r: d[0], g: d[1], b: d[2] };
      });
    },
    { b64, points },
  );
}

const dist = (p, q) => Math.max(Math.abs(p.r - q.r), Math.abs(p.g - q.g), Math.abs(p.b - q.b));

/** Grid of sample points inside a horizontal band of the tile box. */
function bandPoints(box, side, inset = 8, count = 7) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const y = box.y + ((i + 1) / (count + 1)) * box.h;
    if (side === "left") pts.push({ x: box.x + inset, y });
    if (side === "left2") pts.push({ x: box.x + 30, y });
    if (side === "right") pts.push({ x: box.x + box.w - inset, y });
    if (side === "right2") pts.push({ x: box.x + box.w - 30, y });
  }
  return pts;
}
function regionPoints(box, fx0, fx1, fy0, fy1, n = 9) {
  const pts = [];
  const side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < side; i++)
    for (let j = 0; j < side; j++) {
      pts.push({
        x: box.x + box.w * (fx0 + ((i + 0.5) / side) * (fx1 - fx0)),
        y: box.y + box.h * (fy0 + ((j + 0.5) / side) * (fy1 - fy0)),
      });
    }
  return pts;
}

async function analyzeMode(objectId, scenario, fit) {
  const g = await sampleGeometry(objectId);
  if (g.error) return { fit, error: g.error };
  const box = g.videoBox;
  const outside = [
    { x: box.x - 15, y: box.y + box.h / 2 },
    { x: box.x + box.w + 15, y: box.y + box.h / 2 },
    { x: box.x + box.w / 2, y: box.y - 15 },
    { x: box.x + box.w / 2, y: box.y + box.h + 15 },
  ];
  const left = bandPoints(box, "left").concat(bandPoints(box, "left2"));
  const right = bandPoints(box, "right").concat(bandPoints(box, "right2"));
  const center = regionPoints(box, 0.4, 0.6, 0.4, 0.6, 4);
  const bottomRight = regionPoints(box, 0.75, 0.97, 0.75, 0.97, 9);
  const all = [...outside, ...left, ...right, ...center, ...bottomRight];
  const px = await samplePixels(all);
  let k = 0;
  const take = (n) => px.slice(k, (k += n));
  const pOutside = take(outside.length);
  const pLeft = take(left.length);
  const pRight = take(right.length);
  const pCenter = take(center.length);
  const pBR = take(bottomRight.length);
  // Background reference: median-ish of the outside samples.
  const bg = pOutside[0];
  const summarize = (pts) => {
    const ds = pts.map((p) => dist(p, bg));
    const black = pts.filter((p) => p.r < 30 && p.g < 30 && p.b < 30).length;
    return {
      maxDiffVsBg: Math.max(...ds),
      meanDiffVsBg: Math.round(ds.reduce((a, b) => a + b, 0) / ds.length),
      pctNearBg: Math.round((100 * ds.filter((d) => d < 12).length) / ds.length),
      pctBlack: Math.round((100 * black) / pts.length),
    };
  };
  const shot = `${SHOT}/fit-${scenario.slug}-${fit}.png`;
  await page.screenshot({ path: shot, clip: {
    x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 20),
    width: box.w + 40, height: box.h + 40,
  } });
  return {
    fit,
    geometry: {
      storeFit: g.storeFit,
      cssVar: g.cssVar,
      computedObjectFit: g.computedObjectFit,
      path: g.path,
      intrinsic: g.intrinsic,
      paused: g.paused,
      videoBoxEqualsWrapper:
        Math.abs(g.videoBox.w - g.wrapperBox.w) < 1.5 && Math.abs(g.videoBox.h - g.wrapperBox.h) < 1.5,
      videoBox: { w: Math.round(box.w), h: Math.round(box.h) },
    },
    outsideBg: pOutside.map((p) => `${p.r},${p.g},${p.b}`),
    leftBand: summarize(pLeft),
    rightBand: summarize(pRight),
    center: summarize(pCenter),
    bottomRight: summarize(pBR),
    shot,
  };
}

const results = [];
try {
  await page.goto("/login");
  await page.locator('input[name="username"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30_000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
  log("logged in");

  for (const scenario of SCENARIOS) {
    log(`\n=== scenario: ${scenario.name} ===`);
    const objectId = await openStageAndPlaceTile(scenario.tile);
    log("tile placed:", objectId);
    startPublisher(scenario);
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
    if (!live) {
      log("FAIL: tile never reached playing state");
      results.push({ scenario: scenario.name, error: "never played" });
      await stopPublisher();
      continue;
    }
    await page.waitForTimeout(6_000); // settle
    const modes = [];
    for (const fit of scenario.fits) {
      await setFitViaMenu(objectId, fit);
      const r = await analyzeMode(objectId, scenario, fit);
      log(`mode=${fit}:`, JSON.stringify(r));
      modes.push(r);
    }
    results.push({ scenario: scenario.name, modes });
    await stopPublisher();
    await page.waitForTimeout(4_000);
  }
} finally {
  await stopPublisher();
  await browser.close();
}

log("\n==== SUMMARY ====");
for (const r of results) {
  if (r.error) {
    log(`${r.scenario}: ERROR ${r.error}`);
    continue;
  }
  log(`${r.scenario}:`);
  for (const m of r.modes) {
    if (m.error) { log(`  ${m.fit}: ERROR ${m.error}`); continue; }
    log(
      `  ${m.fit}: store=${m.geometry.storeFit} css=${m.geometry.computedObjectFit} path=${m.geometry.path} ` +
      `intrinsic=${m.geometry.intrinsic.w}x${m.geometry.intrinsic.h} boxOK=${m.geometry.videoBoxEqualsWrapper} ` +
      `L(nearBg%=${m.leftBand.pctNearBg},black%=${m.leftBand.pctBlack}) R(nearBg%=${m.rightBand.pctNearBg},black%=${m.rightBand.pctBlack}) ` +
      `BR(nearBg%=${m.bottomRight.pctNearBg},black%=${m.bottomRight.pctBlack}) C(nearBg%=${m.center.pctNearBg})`,
    );
  }
}
