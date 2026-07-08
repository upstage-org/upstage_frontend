#!/usr/bin/env node
/**
 * Regression check: multi-frame avatar animation must NEVER flash the
 * notfound placeholder (assets/notfound.svg — the arms-up outline) when a
 * frame is slow to (re)load or fails outright. Media on dev is served
 * `cache-control: no-cache, must-revalidate`, so every frame swap used to
 * revalidate over the network; a failed request flipped AppImage to the
 * placeholder mid-animation, or left it stuck there when the failure hit
 * the last swap of a play-once run.
 *
 * Scenarios (Playwright routing disables the HTTP cache, so every frame
 * display genuinely hits the network — a faithful stand-in for no-cache):
 *   A. Loop with one mid frame hard-failing: the animation keeps cycling,
 *      skips the dead frame visually (previous frame stays), no placeholder.
 *   B. Un-block the frame: the animation self-heals and shows it again.
 *   C. Play-once (frameLoop=false) with the LAST frame failing: the run
 *      ends showing a real frame, not the placeholder, and not blank.
 *
 * The avatar is placed with liveAction:false (white bulb) so nothing is
 * broadcast — the check is invisible to anyone else on the stage.
 *
 * Usage (against a local SPA server, e.g. `npx vite --port 3001`):
 *   node tests/e2e/scripts/frame-fallback-check.mjs
 * Env:
 *   BASE_URL   default http://127.0.0.1:3001
 *   STAGE      default touch-draw-test
 *   E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD   login (defaults admin / Secret@123)
 *   FRAME_SRCS optional comma-separated frame URLs (defaults: the dev
 *              "Julius" avatar's 10 frames under /resources/media/)
 *   SHOT_DIR   screenshot dir on failure (default ".")
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3001";
const STAGE = (process.env.STAGE ?? "touch-draw-test").replace(/^\//, "");
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const SHOT = process.env.SHOT_DIR ?? ".";

const JULIUS = [
  "449bfb155e34441fbd6b08559b467e9bjulius_01.png",
  "3c6cc85a7f2043e0b4262e553cfa353ejulius_02.png",
  "92fe2a2936514406927b0e06a1b9a07ejulius_03.png",
  "d4f30dfcfe5d4d738ab77a0e827bc4b5julius_04.png",
  "721b1dcad29a4e21876cc9ef23a24860julius_05.png",
  "bde860babdcf4e5cb09e11d1b0e263d4julius_06.png",
  "a672e94215dc446d9b631b9132b1c69fjulius_07.png",
  "b3a29e4101204a8a968a43468096abedjulius_08.png",
  "9c965df6a59f417b8466db6ebba576f7julius_09.png",
  "fa45178e2f674c6c9414d9d8170da6a0julius_10.png",
].map((f) => `/resources/media/${f}`);
const FRAMES = process.env.FRAME_SRCS ? process.env.FRAME_SRCS.split(",") : JULIUS;
const SPEED = 0.3; // autoplayFrames seconds per frame

const log = (...a) => console.log("[frame-check]", ...a);
let failures = 0;
const check = (ok, label) => {
  console.log(`[frame-check] ${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures += 1;
};

// Frame URLs blocked at the network layer, mutated between scenarios.
const blocked = new Set();

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
page.on("pageerror", (e) => log("pageerror:", e.message));

// Routing any pattern disables the HTTP cache in Chromium, so every frame
// swap re-requests its file — exactly the no-cache dev nginx behaviour.
await page.route("**/resources/media/**", (route) => {
  const url = route.request().url();
  for (const b of blocked) {
    if (url.includes(b)) return route.abort();
  }
  return route.continue();
});

try {
  // --- login + open stage (same flow as recording-snapshot-check) ---
  await page.goto("/login");
  await page.locator('input[name="username"]').first().fill(USER);
  await page.locator('input[type="password"]').first().fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
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

  // --- watchdog: sample every board <img> for placeholder/blank frames ---
  await page.evaluate(() => {
    window.__frameWatch = { seen: new Set(), notfound: 0, blank: 0, baseline: null };
    const count = () => {
      const w = window.__frameWatch;
      let nf = 0;
      let blank = 0;
      document.querySelectorAll("img.the-object").forEach((img) => {
        const src = img.getAttribute("src") ?? "";
        if (src.includes("notfound.svg")) nf += 1;
        else if (!src) blank += 1;
        else if (src.includes("julius") || src.includes("frame-check")) w.seen.add(src);
      });
      return { nf, blank };
    };
    // Pre-existing broken/src-less media on the stage is not ours: only
    // count placeholders/blanks BEYOND what the board showed at start.
    window.__frameWatch.baseline = count();
    const scan = () => {
      const w = window.__frameWatch;
      const { nf, blank } = count();
      if (nf > w.baseline.nf) w.notfound += 1;
      if (blank > w.baseline.blank) w.blank += 1;
    };
    window.__frameWatchTimer = setInterval(scan, 50);
  });

  // --- place a local-only (white bulb, never broadcast) julius avatar ---
  const objectId = await page.evaluate(
    ({ frames }) => {
      const s = window.__UPSTAGE_PINIA__.stage;
      const placed = s.placeObjectOnStage({
        type: "avatar",
        name: "frame-check-julius",
        src: frames[0],
        frames,
        multi: true,
        liveAction: false,
        x: 300,
        y: 200,
        w: 150,
        h: 120,
      });
      return placed.id;
    },
    { frames: FRAMES },
  );
  const liveObject = () =>
    page.evaluate((id) => {
      const o = window.__UPSTAGE_PINIA__.stage.board.objects.find((x) => x.id === id);
      return o ? JSON.parse(JSON.stringify(o)) : null;
    }, objectId);
  const startAutoplay = (extra) =>
    page.evaluate(
      ({ id, extra }) => {
        const s = window.__UPSTAGE_PINIA__.stage;
        const o = s.board.objects.find((x) => x.id === id);
        s.toggleAutoplayFrames({ ...o, ...extra });
      },
      { id: objectId, extra },
    );
  const watchState = () =>
    page.evaluate(() => {
      const w = window.__frameWatch;
      return { seen: [...w.seen], notfound: w.notfound, blank: w.blank };
    });

  // ---------- Scenario A: loop with a dead middle frame ----------
  const deadMid = FRAMES[4];
  blocked.add(deadMid);
  await startAutoplay({ autoplayFrames: SPEED, frameLoop: true });
  await page.waitForTimeout(FRAMES.length * SPEED * 1000 * 2 + 1500); // ~2 cycles
  let w = await watchState();
  const distinct = w.seen.filter((s) => !s.includes(deadMid)).length;
  check(w.notfound === 0, `A: no placeholder during loop with a failing frame (${w.notfound} hits)`);
  check(w.blank === 0, `A: no blank frame during loop (${w.blank} hits)`);
  check(
    !w.seen.some((s) => s.includes(deadMid)),
    "A: the failing frame is skipped (previous frame holds)",
  );
  check(
    distinct >= FRAMES.length - 2,
    `A: the other frames all cycle (${distinct}/${FRAMES.length - 1} seen)`,
  );

  // ---------- Scenario B: un-block → self-heal ----------
  blocked.delete(deadMid);
  await page.waitForTimeout(FRAMES.length * SPEED * 1000 + 1500); // one more cycle
  w = await watchState();
  check(
    w.seen.some((s) => s.includes(deadMid)),
    "B: animation self-heals once the frame loads again",
  );
  check(w.notfound === 0, `B: still no placeholder (${w.notfound} hits)`);

  // ---------- Scenario C: play-once ending on a dead LAST frame ----------
  await startAutoplay({ autoplayFrames: null, lastAutoplayFrames: SPEED }); // stop
  await page.waitForTimeout(500);
  const deadLast = FRAMES[FRAMES.length - 1];
  blocked.add(deadLast);
  await startAutoplay({ autoplayFrames: SPEED, frameLoop: false });
  // Wait for the play-once run to finish (autoplayFrames drops back to null).
  await page.waitForFunction(
    (id) =>
      !window.__UPSTAGE_PINIA__.stage.board.objects.find((x) => x.id === id)?.autoplayFrames,
    objectId,
    { timeout: FRAMES.length * SPEED * 1000 * 2 + 10000 },
  );
  await page.waitForTimeout(2000); // let any fade settle
  w = await watchState();
  const ending = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img.the-object")];
    return imgs.map((i) => i.getAttribute("src") ?? "").filter((s) => s.includes("julius"));
  });
  const endObj = await liveObject();
  check(w.notfound === 0, `C: no placeholder at/after the end of play-once (${w.notfound} hits)`);
  check(
    ending.length >= 1 && !ending.some((s) => s.includes(deadLast)),
    `C: tile ends on the last GOOD frame (showing ${ending[0]?.split("/").pop() ?? "nothing"})`,
  );
  check(endObj && !endObj.autoplayFrames, "C: play-once run actually stopped");

  // --- cleanup: local-only delete of our white-bulb object ---
  await page.evaluate((id) => {
    const s = window.__UPSTAGE_PINIA__.stage;
    const o = s.board.objects.find((x) => x.id === id);
    if (o) s.deleteObject(o);
  }, objectId);
} catch (e) {
  failures += 1;
  log("ERROR:", e.message);
  await page.screenshot({ path: `${SHOT}/frame-check-error.png` }).catch(() => {});
} finally {
  await browser.close();
  log(failures ? `${failures} FAILURE(S)` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}
