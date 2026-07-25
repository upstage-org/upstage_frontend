#!/usr/bin/env node
/**
 * OBS "squeezed vertical sliver" reproduction probe (2026-07-25).
 *
 * Owner report: OBS RTMP feed renders as a thin, horizontally-squeezed
 * vertical strip on the stage tile; phone RTMP-streamer app renders fine.
 * object-fit is `contain`, which letterboxes at the video's INTRINSIC
 * aspect — so the suspect is what the browser decodes, not tile CSS.
 *
 * For each synthetic feed scenario this script:
 *   1. publishes the feed from inside the mediamtx_rtmp container
 *      (ffmpeg, silent AAC audio, testsrc2 geometry so distortion is
 *      instantly visible),
 *   2. opens the real stage app (local vite, dev backend), places an
 *      RTMP tile store-side (local-only, unpublished — invisible to
 *      anyone else, nothing broadcast),
 *   3. waits for playback, then samples: intrinsic videoWidth/Height,
 *      active path (WHEP srcObject vs hls.js blob), computed object-fit,
 *      WebRTC inbound-rtp frameWidth/Height, rendered boxes,
 *   4. screenshots the tile.
 *
 * Usage: node tests/e2e/scripts/obs-sliver-probe.mjs   (vite already up)
 * Env: BASE_URL, STAGE, KEY, TOKEN, SHOT_DIR, MATRIX=standard|exotic|all
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
const MATRIX = process.env.MATRIX ?? "standard";

if (!TOKEN) {
  console.error("TOKEN env is required (RTMP publish token)");
  process.exit(2);
}

const log = (...a) => console.log("[obs-probe]", ...a);

// ---------------------------------------------------------------- feeds ----
// All: silent AAC audio (exercises the Opus mirror), 30 fps, yuv420p.
const RTMP_URL = `rtmp://127.0.0.1:1935/live/${KEY}?token=${TOKEN}`;

const STANDARD = [
  {
    name: "phone-like (baseline, bf=0, g=60, 640x480)",
    slug: "phone",
    size: "640x480",
    encArgs: ["-profile:v", "baseline", "-tune", "zerolatency", "-bf", "0", "-g", "60", "-b:v", "1200k"],
    settleMs: 12_000,
  },
  {
    name: "OBS defaults (high profile, bf=2, g=250, 1920x1080)",
    slug: "obs-default",
    size: "1920x1080",
    encArgs: ["-profile:v", "high", "-preset", "veryfast", "-bf", "2", "-g", "250", "-b:v", "2500k"],
    // WHEP dies ~6s in, HLS startup for 8s GOP is slow — generous budget.
    settleMs: 25_000,
    liveTimeoutMs: 90_000,
  },
  {
    name: "OBS per checklist (high profile, bf=0, g=120, 1920x1080)",
    slug: "obs-checklist",
    size: "1920x1080",
    encArgs: ["-profile:v", "high", "-preset", "veryfast", "-tune", "zerolatency", "-bf", "0", "-g", "120", "-b:v", "2500k"],
    settleMs: 12_000,
  },
];

// Discriminators for a tall-narrow intrinsic aspect: non-square SAR
// (anamorphic flag in the H.264 VUI), interlaced encode, portrait canvas,
// and non-mod-16 width (SPS frame-cropping in play).
const EXOTIC = [
  {
    name: "SAR 1:10 anamorphic over WHEP (bf=0, g=120, 1920x1080)",
    slug: "sar-whep",
    size: "1920x1080",
    vf: "setsar=1/10",
    encArgs: ["-profile:v", "high", "-preset", "veryfast", "-tune", "zerolatency", "-bf", "0", "-g", "120", "-b:v", "2500k"],
    settleMs: 12_000,
  },
  {
    name: "SAR 1:10 anamorphic over HLS (bf=2, g=250, 1920x1080)",
    slug: "sar-hls",
    size: "1920x1080",
    vf: "setsar=1/10",
    encArgs: ["-profile:v", "high", "-preset", "veryfast", "-bf", "2", "-g", "250", "-b:v", "2500k"],
    settleMs: 25_000,
    liveTimeoutMs: 90_000,
  },
  {
    name: "interlaced tff (bf=0, g=120, 1920x1080)",
    slug: "interlaced",
    size: "1920x1080",
    encArgs: ["-profile:v", "high", "-preset", "veryfast", "-bf", "0", "-g", "120", "-b:v", "2500k", "-flags", "+ilme+ildct", "-x264opts", "tff=1"],
    settleMs: 12_000,
  },
  {
    name: "portrait canvas (bf=0, g=120, 1080x1920)",
    slug: "portrait",
    size: "1080x1920",
    encArgs: ["-profile:v", "high", "-preset", "veryfast", "-tune", "zerolatency", "-bf", "0", "-g", "120", "-b:v", "2500k"],
    settleMs: 12_000,
  },
  {
    name: "non-mod16 width, SPS crop (bf=0, g=120, 1366x768)",
    slug: "crop1366",
    size: "1366x768",
    encArgs: ["-profile:v", "high", "-preset", "veryfast", "-tune", "zerolatency", "-bf", "0", "-g", "120", "-b:v", "2000k"],
    settleMs: 12_000,
  },
];

// The measured owner symptom: sliver AR ≈ 0.101 ⇒ intrinsic ≈ 108x1080 —
// a 16:9 canvas hard-stretched into a rescale resolution missing a digit
// (OBS "Rescale Output" / "Output (Scaled) Resolution" typo). OBS distorts
// (no letterbox) when the rescale aspect differs from the canvas, hence
// scale=108:1080 on 16:9 content.
const CONFIRM = [
  {
    name: "OBS rescale typo repro (108x1080 from 16:9 canvas, bf=0, g=120)",
    slug: "typo-rescale",
    size: "1920x1080",
    vf: "scale=108:1080,setsar=1",
    encArgs: ["-profile:v", "high", "-preset", "veryfast", "-tune", "zerolatency", "-bf", "0", "-g", "120", "-b:v", "800k"],
    settleMs: 12_000,
  },
];

const SCENARIOS =
  MATRIX === "exotic" ? EXOTIC
  : MATRIX === "confirm" ? CONFIRM
  : MATRIX === "all" ? [...STANDARD, ...EXOTIC, ...CONFIRM]
  : STANDARD;

let publisher = null;

function startPublisher(scenario) {
  const args = [
    "exec", "mediamtx_rtmp", "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-re",
    "-f", "lavfi", "-i", `testsrc2=size=${scenario.size}:rate=30`,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    ...(scenario.vf ? ["-vf", scenario.vf] : []),
    "-c:v", "libx264",
    ...scenario.encArgs,
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k",
    "-f", "flv", RTMP_URL,
  ];
  log(`publisher up: ${scenario.name}`);
  publisher = spawn("docker", args, { stdio: ["ignore", "inherit", "inherit"] });
  publisher.on("exit", (code, sig) => log(`publisher exited (${code ?? sig})`));
}

async function stopPublisher() {
  if (!publisher) return;
  const p = publisher;
  publisher = null;
  p.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1500));
  // The docker CLI forwards SIGTERM; make sure no ffmpeg lingers either way.
  await new Promise((r) =>
    execFile("docker", ["exec", "mediamtx_rtmp", "sh", "-c", "pkill -f 'f flv' || true"], r),
  );
  log("publisher stopped");
}

// -------------------------------------------------------------- browser ----
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1280, height: 800 },
});
// Collect every RTCPeerConnection the app creates so we can read
// inbound-rtp frame dimensions (the component doesn't expose its pc).
await context.addInitScript(() => {
  window.__pcs = [];
  const Original = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Original {
    constructor(...a) {
      super(...a);
      window.__pcs.push(this);
    }
  };
});
const page = await context.newPage();
page.on("pageerror", (e) => log("pageerror:", e.message));
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("[stage] live stream")) log("app:", t);
});

async function openStageAndPlaceTile() {
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
  // Local-only, unpublished: nothing is broadcast, nobody else sees it.
  return await page.evaluate(
    ({ key }) => {
      const placed = window.__UPSTAGE_PINIA__.stage.placeObjectOnStage({
        type: "video",
        isRTMP: true,
        name: "obs-probe-tile",
        fileLocation: key,
        w: 480,
        h: 360,
        x: 320,
        y: 240,
        liveAction: false,
        published: false,
      });
      return placed.id;
    },
    { key: KEY },
  );
}

async function sample(objectId) {
  return await page.evaluate(async (id) => {
    const el = document.getElementById(`video${id}`);
    if (!el) return { error: "no video element" };
    const wrapper = document.querySelector(`[data-object-id="${id}"]`);
    const stats = [];
    for (const pc of window.__pcs) {
      if (pc.connectionState === "closed") continue;
      try {
        const s = await pc.getStats();
        s.forEach((r) => {
          if (r.type === "inbound-rtp" && r.kind === "video") {
            stats.push({
              frameWidth: r.frameWidth,
              frameHeight: r.frameHeight,
              framesDecoded: r.framesDecoded,
              connState: pc.connectionState,
            });
          }
        });
      } catch {}
    }
    const style = getComputedStyle(el);
    const vr = el.getBoundingClientRect();
    const wr = wrapper ? wrapper.getBoundingClientRect() : null;
    return {
      path: el.srcObject ? "WHEP(WebRTC)" : el.src?.startsWith("blob:") ? "HLS(hls.js)" : el.src ? "HLS(native)" : "none",
      videoWidth: el.videoWidth,
      videoHeight: el.videoHeight,
      readyState: el.readyState,
      paused: el.paused,
      objectFit: style.objectFit,
      videoBox: { w: Math.round(vr.width), h: Math.round(vr.height) },
      wrapperBox: wr ? { w: Math.round(wr.width), h: Math.round(wr.height) } : null,
      rtcInboundVideo: stats,
    };
  }, objectId);
}

const results = [];
try {
  // --- login once ---
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
    // Fresh page per scenario: resets the player's whepBroken verdict.
    const objectId = await openStageAndPlaceTile();
    log("tile placed:", objectId);
    startPublisher(scenario);

    const liveTimeout = scenario.liveTimeoutMs ?? 60_000;
    const live = await page
      .waitForFunction(
        (id) => {
          const el = document.getElementById(`video${id}`);
          return el && el.videoWidth > 0 && el.readyState >= 2;
        },
        objectId,
        { timeout: liveTimeout },
      )
      .then(() => true)
      .catch(() => false);
    if (!live) {
      log("FAIL: tile never reached playable state");
      results.push({ scenario: scenario.name, error: "never played" });
      await stopPublisher();
      continue;
    }
    await page.waitForTimeout(scenario.settleMs); // let watchdog/fallback settle
    const early = await sample(objectId);
    await page.waitForTimeout(5_000);
    const late = await sample(objectId);
    const shot = `${SHOT}/probe-${scenario.slug}.png`;
    const wrapper = page.locator(`[data-object-id="${objectId}"]`);
    await wrapper.screenshot({ path: shot }).catch(async () => {
      await page.screenshot({ path: shot });
    });
    await page.screenshot({ path: `${SHOT}/probe-${scenario.slug}-full.png` });
    log("sample(early):", JSON.stringify(early));
    log("sample(late): ", JSON.stringify(late));
    results.push({ scenario: scenario.name, early, late, shot });
    await stopPublisher();
    // Let MediaMTX fully drop the path (mirror teardown) between feeds.
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
  const s = r.late;
  const intrinsic = `${s.videoWidth}x${s.videoHeight}`;
  const ar = s.videoHeight ? (s.videoWidth / s.videoHeight).toFixed(3) : "?";
  log(`${r.scenario}: path=${s.path} intrinsic=${intrinsic} (AR ${ar}) fit=${s.objectFit} box=${s.videoBox.w}x${s.videoBox.h} rtc=${JSON.stringify(s.rtcInboundVideo)}`);
}
