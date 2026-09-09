#!/usr/bin/env node
/**
 * LIVE two-server Jitsi probe (multi-server streaming, per-tile server binding).
 *
 * Drives the real UI against the running SPA (default http://127.0.0.1:3001 →
 * the disposable e2e backend, see tests/e2e/env/) and the REAL Jitsi servers
 * listed in VITE_JITSI_ENDPOINTS. Uses the e2e stage from tests/e2e/runtime.json
 * — NEVER a slug that exists on dev: the e2e stack shares the dev MQTT
 * namespace (`dev/<slug>/…`) and Jitsi room names are stage slugs, so a shared
 * slug would broadcast test tiles onto the real dev stage.
 *
 * Checks (performer = admin with a fake camera, audience = anonymous tab):
 *   1. one Yourself tile per configured server; performer joins both servers;
 *   2. double-clicking the second tile places a tile bound to server B with
 *      B's participant id, published there from CLONED tracks — nothing is
 *      sent to the default room;
 *   3. an audience tab receives the tile, opens a session on B only because
 *      the tile needs it, and renders frames;
 *   4. a second tile on the default server ⇒ both servers carry the camera at
 *      once; the audience renders both; removing one leaves the other alone;
 *   5. removing the last tile on B unpublishes + disposes the clones while the
 *      toolbar previews stay live.
 *
 * Run: SHOT_DIR=/tmp node tests/e2e/scripts/two-server-jitsi-probe.mjs
 * (needs the e2e backend + `tests/e2e/env/vite-e2e.sh` up, both Jitsi hosts
 * reachable, and VITE_JITSI_ENDPOINTS with 2 entries in .env).
 */
import { chromium } from "@playwright/test";
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3001";
import { readFileSync } from "node:fs";
const STAGE = JSON.parse(readFileSync("tests/e2e/runtime.json", "utf8")).stageUrl; // e2e-only slug: no shared MQTT topics / Jitsi room with dev
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const J1 = process.env.JITSI_A ?? "https://streaming.upstage.live";
const J2 = process.env.JITSI_B ?? "https://streaming3.upstage.live";
const log = (...a) => console.log("[probe]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const diag = { performer: [], audience: [] };
const newPage = async (name) => {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    permissions: ["camera", "microphone"],
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (t.includes("[diag]") || t.includes("Connection")) diag[name].push(t);
  });
  page.on("pageerror", (e) => log(name, "pageerror:", e.message));
  return page;
};
const login = async (page, user = USER, pass = PASS) => {
  await page.goto("/login");
  await page.locator('input[name="username"]').first().fill(user);
  await page.locator('input[type="password"]').first().fill(pass);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 30000 }),
    page.locator('button[type="submit"]').first().click(),
  ]);
};
const openStage = async (page) => {
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
};
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  log(ok ? "PASS" : "FAIL", name, detail);
};
try {
  const performer = await newPage("performer");
  await login(performer);
  await openStage(performer);
  await performer.locator('a.panel-block:has(img[src*="meeting.svg"])').first().click();
  await performer.locator("#topbar video").nth(1).waitFor({ state: "attached", timeout: 20000 });
  check("two Yourself tiles rendered", (await performer.locator("#topbar video").count()) === 2);
  // Performer joins both servers up front → ids for both.
  await performer
    .waitForFunction(
      ([a, b]) => {
        const m = window.__UPSTAGE_PINIA__.stage.localJitsiParticipantIds || {};
        return !!m[a] && !!m[b];
      },
      [J1, J2],
      { timeout: 60000 },
    )
    .catch(() => {});
  const ids = await performer.evaluate(
    () => window.__UPSTAGE_PINIA__.stage.localJitsiParticipantIds,
  );
  check(
    "performer joined both servers (ids per server)",
    !!ids[J1] && !!ids[J2],
    JSON.stringify(ids),
  );
  // Place the streaming3 tile via the real UI: double-click its skeleton.
  const secondSkeleton = performer
    .locator("#topbar .skeleton")
    .filter({ has: performer.locator("video") })
    .nth(1);
  await secondSkeleton.dblclick();
  await performer.waitForFunction(
    (j2) =>
      window.__UPSTAGE_PINIA__.stage.board.objects.some(
        (o) => o.type === "jitsi" && o.jitsiServer === j2,
      ),
    J2,
    { timeout: 10000 },
  );
  const tile = await performer.evaluate(
    (j2) =>
      window.__UPSTAGE_PINIA__.stage.board.objects.find(
        (o) => o.type === "jitsi" && o.jitsiServer === j2,
      ),
    J2,
  );
  check(
    "placed tile is bound to streaming3 with streaming3's participant id",
    tile.jitsiServer === J2 && tile.participantId === ids[J2],
    JSON.stringify({ pid: tile.participantId, want: ids[J2] }),
  );
  check(
    "no tile on the default server",
    !(await performer.evaluate(() =>
      window.__UPSTAGE_PINIA__.stage.board.objects.some(
        (o) => o.type === "jitsi" && !o.jitsiServer,
      ),
    )),
  );
  // Clones published into streaming3's room.
  await performer
    .waitForFunction(() => window.__UPSTAGE_PINIA__.stage.jitsiTracks.length >= 2, null, {
      timeout: 30000,
    })
    .catch(() => {});
  const trackInfo = await performer.evaluate(() => {
    const s = window.__UPSTAGE_PINIA__.stage;
    return s.jitsiTracks.map((t) => ({
      type: t.type,
      local: t.isLocal?.(),
      pid: t.getParticipantId?.(),
      server: s.trackServer(t),
    }));
  }, J2);
  const localInfo = trackInfo.filter((t) => t.local);
  check(
    "performer's 2 local tracks are tagged streaming3 (none on the default server)",
    localInfo.length === 2 && localInfo.every((t) => t.server === J2 && t.pid === ids[J2]),
    JSON.stringify(trackInfo),
  );
  check(
    "extra publisher logged publish on streaming3",
    diag.performer.some(
      (l) => l.includes("extraServerPublishers: published") && l.includes("streaming3"),
    ),
  );
  check(
    "primary publisher never published to default (no own-jitsi-on-board publish)",
    !diag.performer.some(
      (l) =>
        l.includes("tryPublishWhenReady") &&
        l.includes('"own-jitsi-on-board"') &&
        l.includes("pendingPublish: true"),
    ),
    "",
  );
  // Performer's own on-stage tile renders frames.
  await performer
    .waitForFunction(
      () =>
        [...document.querySelectorAll("video")].some(
          (v) => !v.closest("#topbar") && v.videoWidth > 0,
        ),
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  const perfTile = await performer.evaluate(() =>
    [...document.querySelectorAll("video")]
      .filter((v) => !v.closest("#topbar"))
      .map((v) => ({ w: v.videoWidth, h: v.videoHeight, src: !!v.srcObject })),
  );
  check(
    "performer's on-stage streaming3 tile has video frames",
    perfTile.some((v) => v.w > 0),
    JSON.stringify(perfTile),
  );
  // Audience connects FIRST (the e2e stack has no event archive, so a late
  // joiner would never replay the PLACE), then the bulb is lit.
  let audience = await newPage("audience");
  await audience.goto(STAGE);
  const anon = await audience
    .waitForFunction(() => window.__UPSTAGE_PINIA__?.stage?.model, null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!anon) {
    log("anonymous audience cannot open the stage; logging in as player 'sampson'");
    await audience.context().close();
    audience = await newPage("audience");
    await login(audience, "sampson", process.env.E2E_PLAYER_PASSWORD ?? "e2e-pw-2026");
  }
  await openStage(audience);
  const perm = await audience.evaluate(() => ({
    perm: window.__UPSTAGE_PINIA__.stage.model?.permission,
    canPlay: !!window.__UPSTAGE_PINIA__.stage.canPlay,
    status: window.__UPSTAGE_PINIA__.stage.status,
  }));
  log("audience permission", JSON.stringify(perm));
  await audience
    .waitForFunction(() => window.__UPSTAGE_PINIA__.stage.status === "LIVE", null, {
      timeout: 30000,
    })
    .catch(() => {});
  await sleep(1000);
  // Light the bulb → broadcast to the audience.
  await performer.evaluate((id) => {
    const s = window.__UPSTAGE_PINIA__.stage;
    const o = s.board.objects.find((x) => x.id === id);
    s.shapeObject({ ...o, liveAction: true });
  }, tile.id);
  await audience
    .waitForFunction(
      (id) => window.__UPSTAGE_PINIA__.stage.board.objects.some((o) => o.id === id),
      tile.id,
      { timeout: 30000 },
    )
    .catch(() => {});
  const audTile = await audience.evaluate(
    (id) => window.__UPSTAGE_PINIA__.stage.board.objects.find((o) => o.id === id),
    tile.id,
  );
  check(
    "audience received the tile with jitsiServer=streaming3",
    !!audTile && audTile.jitsiServer === J2 && audTile.participantId === ids[J2],
    JSON.stringify(audTile && { jitsiServer: audTile.jitsiServer, pid: audTile.participantId }),
  );
  await audience
    .waitForFunction(
      () => [...document.querySelectorAll("video")].some((v) => v.videoWidth > 0),
      null,
      { timeout: 60000 },
    )
    .catch(() => {});
  check(
    "audience opened a session on streaming3",
    diag.audience.some((l) => l.includes("opening session") && l.includes("streaming3")),
  );
  const audTracks = await audience.evaluate(() => {
    const s = window.__UPSTAGE_PINIA__.stage;
    return s.jitsiTracks.map((t) => ({
      type: t.type,
      pid: t.getParticipantId?.(),
      server: s.trackServer(t),
    }));
  }, J2);
  check(
    "audience received tracks tagged streaming3 for the performer's id",
    audTracks.some((t) => t.server === J2 && t.pid === ids[J2]),
    JSON.stringify(audTracks),
  );
  const audVideo = await audience.evaluate(() =>
    [...document.querySelectorAll("video")].map((v) => ({ w: v.videoWidth, h: v.videoHeight })),
  );
  check(
    "audience tile shows video frames",
    audVideo.some((v) => v.w > 0),
    JSON.stringify(audVideo),
  );
  await audience.screenshot({ path: (process.env.SHOT_DIR ?? ".") + "/audience-streaming3.png" });
  await performer.screenshot({ path: (process.env.SHOT_DIR ?? ".") + "/performer-streaming3.png" });

  // BOTH servers at once: add a default-server tile next to the streaming3 one.
  const firstSkeleton = performer
    .locator("#topbar .skeleton")
    .filter({ has: performer.locator("video") })
    .nth(0);
  await firstSkeleton.dblclick();
  await performer.waitForFunction(
    (j1) =>
      window.__UPSTAGE_PINIA__.stage.board.objects.some(
        (o) => o.type === "jitsi" && o.jitsiServer === j1,
      ),
    J1,
    { timeout: 10000 },
  );
  const tileA = await performer.evaluate(
    (j1) =>
      window.__UPSTAGE_PINIA__.stage.board.objects.find(
        (o) => o.type === "jitsi" && o.jitsiServer === j1,
      ),
    J1,
  );
  check(
    "default-server tile is bound to the default server with its participant id",
    tileA.participantId === ids[J1] && tileA.jitsiServer === J1,
    JSON.stringify({ pid: tileA.participantId, want: ids[J1] }),
  );
  await performer
    .waitForFunction(
      () => window.__UPSTAGE_PINIA__.stage.jitsiTracks.filter((t) => t.isLocal?.()).length >= 4,
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  const bothLocal = await performer.evaluate(() => {
    const s = window.__UPSTAGE_PINIA__.stage;
    return s.jitsiTracks
      .filter((t) => t.isLocal?.())
      .map((t) => ({
        type: t.type,
        pid: t.getParticipantId?.(),
        server: s.trackServer(t) ?? "default(untagged)",
      }));
  });
  // Default-room tracks are tagged with the default origin by the composable's
  // TRACK_ADDED (multi-server) — or untagged if only the publisher recorded them.
  check(
    "performer now publishes to BOTH servers at once (2 tracks each)",
    bothLocal.filter((t) => t.server === J2).length === 2 &&
      bothLocal.filter(
        (t) => (t.server === J1 || t.server === "default(untagged)") && t.pid === ids[J1],
      ).length === 2,
    JSON.stringify(bothLocal),
  );
  await performer.evaluate((id) => {
    const s = window.__UPSTAGE_PINIA__.stage;
    const o = s.board.objects.find((x) => x.id === id);
    s.shapeObject({ ...o, liveAction: true });
  }, tileA.id);
  await audience
    .waitForFunction(
      (id) => window.__UPSTAGE_PINIA__.stage.board.objects.some((o) => o.id === id),
      tileA.id,
      { timeout: 30000 },
    )
    .catch(() => {});
  await audience
    .waitForFunction(
      () => [...document.querySelectorAll("video")].filter((v) => v.videoWidth > 0).length >= 2,
      null,
      { timeout: 60000 },
    )
    .catch(() => {});
  const audBoth = await audience.evaluate(() => {
    const s = window.__UPSTAGE_PINIA__.stage;
    return {
      tiles: s.board.objects
        .filter((o) => o.type === "jitsi")
        .map((o) => ({ pid: o.participantId, server: o.jitsiServer ?? "default" })),
      videos: [...document.querySelectorAll("video")].map((v) => v.videoWidth),
      tracks: s.jitsiTracks.map((t) => ({
        pid: t.getParticipantId?.(),
        server: s.trackServer(t) ?? "default(untagged)",
      })),
    };
  }, J2);
  check(
    "audience renders BOTH tiles with frames (one per server)",
    audBoth.tiles.length === 2 &&
      audBoth.videos.filter((w) => w > 0).length === 2 &&
      audBoth.tracks.some((t) => t.pid === ids[J1]) &&
      audBoth.tracks.some((t) => t.pid === ids[J2] && t.server === J2),
    JSON.stringify(audBoth),
  );
  await audience.screenshot({ path: (process.env.SHOT_DIR ?? ".") + "/audience-both-servers.png" });
  await performer.screenshot({
    path: (process.env.SHOT_DIR ?? ".") + "/performer-both-servers.png",
  });
  // Remove only the default-server tile: streaming3 must keep going.
  await performer.evaluate((id) => {
    const s = window.__UPSTAGE_PINIA__.stage;
    const o = s.board.objects.find((x) => x.id === id);
    s.deleteObject(o);
  }, tileA.id);
  await sleep(2500);
  const afterA = await performer.evaluate(() => {
    const s = window.__UPSTAGE_PINIA__.stage;
    return s.jitsiTracks
      .filter((t) => t.isLocal?.())
      .map((t) => s.trackServer(t) ?? "default(untagged)");
  });
  check(
    "removing the default-server tile leaves the streaming3 publish untouched",
    afterA.length === 2 && afterA.every((x) => x === J2),
    JSON.stringify(afterA),
  );
  const audAfterA = await audience.evaluate(
    () => [...document.querySelectorAll("video")].filter((v) => v.videoWidth > 0).length,
  );
  check("audience still has the streaming3 tile playing", audAfterA === 1, String(audAfterA));

  // Remove the tile → clones removed + disposed, audience tile gone.
  await performer.evaluate((id) => {
    const s = window.__UPSTAGE_PINIA__.stage;
    const o = s.board.objects.find((x) => x.id === id);
    s.deleteObject(o);
  }, tile.id);
  await performer
    .waitForFunction(() => window.__UPSTAGE_PINIA__.stage.jitsiTracks.length === 0, null, {
      timeout: 15000,
    })
    .catch(() => {});
  const leftover = await performer.evaluate(() => {
    const s = window.__UPSTAGE_PINIA__.stage;
    return s.jitsiTracks.map((t) => ({
      local: t.isLocal?.(),
      pid: t.getParticipantId?.(),
      server: s.trackServer(t) ?? "default(untagged)",
    }));
  });
  check(
    "performer unpublished from streaming3 after tile removal",
    diag.performer.some((l) => l.includes("extraServerPublishers: unpublished")) &&
      !leftover.some((t) => t.server === J2),
    JSON.stringify({
      leftover,
      unpublishedLog: diag.performer.filter((l) => l.includes("extraServerPublishers")).slice(-3),
    }),
  );
  await audience
    .waitForFunction(
      (id) => !window.__UPSTAGE_PINIA__.stage.board.objects.some((o) => o.id === id),
      tile.id,
      { timeout: 15000 },
    )
    .catch(() => {});
  check(
    "audience tile removed",
    !(await audience.evaluate(
      (id) => window.__UPSTAGE_PINIA__.stage.board.objects.some((o) => o.id === id),
      tile.id,
    )),
  );
  // Toolbar preview must survive (camera untouched).
  const preview = await performer.evaluate(() =>
    [...document.querySelectorAll("#topbar video")].map((v) => v.videoWidth),
  );
  check(
    "both Yourself previews still live after unpublish",
    preview.length === 2 && preview.every((w) => w > 0),
    JSON.stringify(preview),
  );
} catch (e) {
  log("ERROR", e?.stack || e);
} finally {
  log(
    "performer diag tail:",
    diag.performer
      .filter((l) => /extraServer|opening session|closing|CONFERENCE_JOINED|Connection/.test(l))
      .slice(-12)
      .join("\n  "),
  );
  log(
    "audience diag tail:",
    diag.audience
      .filter((l) => /opening session|closing|CONFERENCE_JOINED|Connection|TRACK_ADDED/.test(l))
      .slice(-8)
      .join("\n  "),
  );
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  log(`SUMMARY ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
