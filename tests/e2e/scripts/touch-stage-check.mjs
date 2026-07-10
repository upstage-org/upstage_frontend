#!/usr/bin/env node
/**
 * Touch-input smoke check for stage interaction (toolbox placement, object
 * dragging, context menu, erase toggle) — companion to touch-draw-check.mjs,
 * which covers the drawing canvases.
 *
 * Dispatches REAL CDP touch events (touchStart → touchMove* → touchEnd) so the
 * browser's own gesture / touch-action pipeline runs — the same path a tablet
 * touch takes. Verifies the 2026-07 tablet usability fixes:
 *   1. html/body carry overscroll-behavior-y: none (pull-to-refresh guard),
 *   2. hold-to-drag from the toolbox survives finger jitter (useDragHoldShim)
 *      and drops an object on the board without reloading the page,
 *   3. double-tap on a toolbox tile places the object at stage centre,
 *   4. touch-dragging an object on stage moves the OBJECT, not the page,
 *   5. a stationary long-press on a stage object opens the context menu and
 *      the menu survives the finger-lift ghost click,
 *   6. the erase toggle shows a distinct .active outline (touch has no
 *      sticky-hover false highlight),
 *   7. (investigation) a placed Jitsi meeting renders its iframe, and the
 *      disable-pointer overlay clears after deselecting the tile.
 *
 * Usage (against an already-running SPA + backend):
 *   node tests/e2e/scripts/touch-stage-check.mjs
 * Env: same as touch-draw-check.mjs
 *   TOUCH_BASE_URL   default http://127.0.0.1:3001
 *   TOUCH_STAGE      default touch-draw-test
 *   E2E_ADMIN_USERNAME / E2E_ADMIN_PASSWORD    login (defaults admin / Secret@123)
 *   TOUCH_MAP_HOST   optional host to resolve to 127.0.0.1
 */
import { chromium } from "@playwright/test";

const BASE = process.env.TOUCH_BASE_URL ?? "http://127.0.0.1:3001";
const STAGE = `/${(process.env.TOUCH_STAGE ?? "touch-draw-test").replace(/^\//, "")}`;
const USER = process.env.E2E_ADMIN_USERNAME ?? "admin";
const PASS = process.env.E2E_ADMIN_PASSWORD ?? "Secret@123";
const MAP_HOST = process.env.TOUCH_MAP_HOST;

const log = (...a) => console.log("[touch-stage]", ...a);
let failures = 0;
const check = (ok, label) => {
  console.log(`[touch-stage] ${ok ? "PASS" : "FAIL"} — ${label}`);
  if (!ok) failures += 1;
};
// Investigation findings (Jitsi) are reported but non-fatal on config-shaped
// problems; behavioural regressions still use check().
const evidence = (label) => console.log(`[touch-stage] EVIDENCE — ${label}`);

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
page.on("pageerror", (e) =>
  log("pageerror:", process.env.TOUCH_STACKS ? (e.stack ?? e.message) : e.message),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // --- login ---
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

  const cdp = await context.newCDPSession(page);
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const tap = async (x, y) => {
    await touch("touchStart", [{ x, y, id: 1 }]);
    await sleep(40);
    await touch("touchEnd", []);
  };
  const objectCount = () =>
    page.evaluate(() => window.__UPSTAGE_PINIA__.stage.board.objects.length);
  const boardObjects = () =>
    page.evaluate(() =>
      window.__UPSTAGE_PINIA__.stage.board.objects.map((o) => ({
        id: o.id,
        type: o.type,
        x: o.x,
        y: o.y,
        w: o.w,
        h: o.h,
      })),
    );
  const stageSize = await page.evaluate(() => {
    const s = window.__UPSTAGE_PINIA__.stage.stageSize;
    return { left: s.left, top: s.top, width: s.width, height: s.height };
  });
  // Viewport point of an object's centre (Board places objects stage-relative).
  const objCentre = (o) => ({
    x: stageSize.left + o.x + o.w / 2,
    y: stageSize.top + o.y + o.h / 2,
  });

  // A tap/drop point that actually lands on the empty #board RIGHT NOW (the
  // left edge is the toolbox nav; the right side is the chat panel; objects
  // placed by earlier steps also move around — so re-evaluate per call).
  // onBoardPointerDown only deselects when e.target IS the board.
  const emptyBoardPoint = () =>
    page.evaluate(
      ([ss]) => {
        const candidates = [
          [ss.left + ss.width / 2, ss.top + ss.height - 40],
          [ss.left + ss.width * 0.35, ss.top + ss.height - 40],
          [ss.left + ss.width * 0.55, ss.top + ss.height - 60],
          [ss.left + ss.width / 2, ss.top + 30],
          [ss.left + ss.width * 0.6, ss.top + ss.height * 0.85],
        ];
        for (const [x, y] of candidates) {
          if (document.elementFromPoint(x, y)?.id === "board") return { x, y };
        }
        return { x: ss.left + ss.width / 2, y: ss.top + ss.height - 40 };
      },
      [stageSize],
    );
  const deselect = async () => {
    const p = await emptyBoardPoint();
    await tap(p.x, p.y);
    await sleep(300);
  };

  // Track what this run adds so it can clean up after itself.
  const initialIds = new Set(
    await page.evaluate(() => window.__UPSTAGE_PINIA__.stage.board.objects.map((o) => o.id)),
  );

  // Reload guard: if pull-to-refresh or navigation sneaks through anywhere
  // below, this marker disappears.
  await page.evaluate(() => (window.__touchStageMark = true));

  // ---------------------------------------------------------------------
  // 1. overscroll-behavior-y
  // ---------------------------------------------------------------------
  const overscroll = await page.evaluate(() => ({
    html: window.getComputedStyle(document.documentElement).overscrollBehaviorY,
    body: window.getComputedStyle(document.body).overscrollBehaviorY,
  }));
  check(
    overscroll.html === "none" && overscroll.body === "none",
    `overscroll-behavior-y is none on html/body (html=${overscroll.html}, body=${overscroll.body})`,
  );

  // ---------------------------------------------------------------------
  // Setup: create a saved drawing so the Draw panel has a placeable tile
  // regardless of what media the stage has assigned.
  // ---------------------------------------------------------------------
  await page.locator('a.panel-block:has(img[src*="object-drawing.svg"])').first().click();
  await page.locator("span.tag", { hasText: "New Drawing" }).first().click();
  const canvas = page.locator("canvas.drawing").first();
  await canvas.waitFor({ state: "visible", timeout: 10000 });
  const cbox = await canvas.boundingBox();
  const ccx = cbox.x + cbox.width / 2;
  const ccy = cbox.y + cbox.height / 2;
  // Diagonal stroke → the saved prop is ~200x150, big enough that its centre
  // stays clear of the selection frame's resize handles when dragged later.
  await touch("touchStart", [{ x: ccx - 100, y: ccy - 75, id: 1 }]);
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", [{ x: ccx - 100 + i * 20, y: ccy - 75 + i * 15, id: 1 }]);
    await sleep(12);
  }
  await touch("touchEnd", []);
  await sleep(200);

  // ---------------------------------------------------------------------
  // 6. erase toggle shows a distinct active state (do this while the
  //    drawing UI is open)
  // ---------------------------------------------------------------------
  const eraseTile = page.locator('#topbar div.drawing-tool:has(img[src*="erase.svg"])').first();
  const ebox = await eraseTile.boundingBox();
  await tap(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2);
  await sleep(150);
  const eraseOn = await eraseTile.evaluate((el) => ({
    active: el.classList.contains("active"),
    outline: window.getComputedStyle(el).outlineStyle,
  }));
  check(
    eraseOn.active && eraseOn.outline !== "none",
    `erase tap activates with a visible outline (active=${eraseOn.active}, outline=${eraseOn.outline})`,
  );
  await tap(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2);
  await sleep(150);
  const eraseOff = await eraseTile.evaluate((el) => ({
    active: el.classList.contains("active"),
    outline: window.getComputedStyle(el).outlineStyle,
  }));
  check(
    !eraseOff.active && eraseOff.outline === "none",
    `second erase tap deactivates and clears the outline (active=${eraseOff.active}, outline=${eraseOff.outline})`,
  );

  // Save the stroke as a prop → creates a saved-drawing toolbox tile
  // (and places one object, which we ignore).
  await page.locator("span.tag", { hasText: "Save as Prop" }).first().click();
  await sleep(500);
  const drawingTile = page.locator("#topbar .skeleton").last();
  await drawingTile.waitFor({ state: "visible", timeout: 10000 });

  // ---------------------------------------------------------------------
  // 3. double-tap on a toolbox tile places the object at stage centre
  // ---------------------------------------------------------------------
  let before = await objectCount();
  let tbox = await drawingTile.boundingBox();
  await tap(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
  await sleep(90);
  await tap(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
  await sleep(500);
  let after = await objectCount();
  check(after === before + 1, `double-tap places a toolbox tile on stage (${before} → ${after})`);
  const placedId = await page.evaluate(
    () => window.__UPSTAGE_PINIA__.stage.board.objects.at(-1)?.id,
  );

  // Deselect so the moveable control box doesn't overlap the next gesture.
  await deselect();

  // ---------------------------------------------------------------------
  // 2. hold-to-drag WITH finger jitter → drop on board, no reload
  // ---------------------------------------------------------------------
  before = await objectCount();
  tbox = await drawingTile.boundingBox();
  const sx = tbox.x + tbox.width / 2;
  const sy = tbox.y + tbox.height / 2;
  // Drop on a point verified to be the board — a fixed offset from centre can
  // land on the chat panel, which has no drop handler (silent no-op).
  const dropPoint = await emptyBoardPoint();
  const dropX = dropPoint.x;
  const dropY = dropPoint.y;
  await touch("touchStart", [{ x: sx, y: sy, id: 1 }]);
  // 2-3px jitter inside the 300ms hold window — this used to abort the
  // polyfill's pending drag (and the swipe then pulled the page down).
  // Keep the jitter well clear of the 300ms boundary: each CDP call adds
  // real latency, and a jitter move landing after the hold converts would
  // test a different scenario.
  for (const [dx, dy] of [
    [2, 1],
    [-1, 2],
    [1, -2],
  ]) {
    await sleep(60);
    await touch("touchMove", [{ x: sx + dx, y: sy + dy, id: 1 }]);
  }
  await sleep(350); // safely past the 300ms hold + shim deactivation
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", [
      { x: sx + ((dropX - sx) * i) / steps, y: sy + ((dropY - sy) * i) / steps, id: 1 },
    ]);
    await sleep(30);
  }
  await touch("touchEnd", []);
  await sleep(600);
  after = await objectCount();
  check(
    after === before + 1,
    `jittery hold-to-drag drops a tile on the board (${before} → ${after})`,
  );
  const markAlive = await page.evaluate(() => window.__touchStageMark === true).catch(() => false);
  check(markAlive, "page did not reload during touch drags (pull-to-refresh guard)");

  await deselect();

  // ---------------------------------------------------------------------
  // 4. touch-dragging a placed object moves the object, not the page.
  //    Touch interaction is two-step by design: the first tap selects the
  //    object (moveable binds its own gesture listeners to the target), the
  //    next touch gesture drags it. Use the largest object so its centre is
  //    clear of the selection frame's resize handles.
  // ---------------------------------------------------------------------
  let objs = await boardObjects();
  const tapTarget = objs.find((o) => o.id === placedId) ?? objs[objs.length - 1];
  const from = objCentre(tapTarget);
  await tap(from.x, from.y);
  // Selection is what the tap must achieve; overlapping objects can mean the
  // topmost one under the point wins, so drag whichever object got selected.
  await page
    .waitForFunction(() => window.__UPSTAGE_PINIA__.stage.activeMovable != null, null, {
      timeout: 3000,
    })
    .catch(() => {});
  const selectedId = await page.evaluate(() => window.__UPSTAGE_PINIA__.stage.activeMovable);
  check(!!selectedId, `tap on a stage object selects it (activeMovable=${selectedId})`);
  const target = objs.find((o) => o.id === selectedId) ?? tapTarget;
  await sleep(300);
  await touch("touchStart", [{ x: from.x, y: from.y, id: 1 }]);
  await sleep(80);
  for (let i = 1; i <= 12; i++) {
    await touch("touchMove", [{ x: from.x - (150 * i) / 12, y: from.y - (80 * i) / 12, id: 1 }]);
    await sleep(30);
  }
  await touch("touchEnd", []);
  await sleep(600);
  objs = await boardObjects();
  const moved = objs.find((o) => o.id === target.id);
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  check(
    moved && (Math.abs(moved.x - target.x) > 50 || Math.abs(moved.y - target.y) > 50),
    `touch drag moves the selected stage object (Δx=${moved ? Math.round(moved.x - target.x) : "?"}, Δy=${moved ? Math.round(moved.y - target.y) : "?"})`,
  );
  check(
    scroll.x === 0 && scroll.y === 0,
    `page did not scroll during object drag (${scroll.x},${scroll.y})`,
  );

  // ---------------------------------------------------------------------
  // 5. stationary long-press opens the context menu; it survives the
  //    finger-lift ghost click
  // ---------------------------------------------------------------------
  // Deselect first: on a selected object the moveable control box (rendered
  // on document.body) can sit exactly over a small object and swallow the
  // touch before it reaches the object's ContextMenu trigger.
  await deselect();
  const lp = objCentre(moved ?? target);
  await touch("touchStart", [{ x: lp.x, y: lp.y, id: 1 }]);
  await sleep(800);
  await touch("touchEnd", []);
  await sleep(150);
  const menu = page.locator('body > .card[style*="z-index: 10000"]');
  const menuOpen = await menu
    .first()
    .isVisible()
    .catch(() => false);
  check(menuOpen, "long-press on a stage object opens the context menu");
  await sleep(400);
  const menuStillOpen = await menu
    .first()
    .isVisible()
    .catch(() => false);
  check(menuStillOpen, "context menu survives the post-lift ghost click");
  // close it
  await deselect();

  // ---------------------------------------------------------------------
  // 7. INVESTIGATION — Jitsi meeting placement
  // ---------------------------------------------------------------------
  const jitsiEnabled = await page.evaluate(
    () => window.__UPSTAGE_PINIA__.stage.jitsiStreamingEnabled,
  );
  if (!jitsiEnabled) {
    evidence("jitsi streaming disabled on this stage (streamingMode) — meeting check skipped");
  } else {
    before = await objectCount();
    await page.evaluate(() => {
      const stage = window.__UPSTAGE_PINIA__.stage;
      const placed = stage.placeObjectOnStage({ type: "meeting", name: "touchcheck" });
      stage.autoFocusMoveable(placed.id);
      window.__meetingId = placed.id;
    });
    await sleep(1000);
    const meeting = await page.evaluate(() => {
      const room = document.getElementById("meeting-room");
      const iframe = room?.querySelector("iframe.room");
      return {
        exists: !!room,
        disabled: room?.classList.contains("disable-pointer") ?? false,
        src: iframe?.getAttribute("src") ?? "",
      };
    });
    evidence(`meeting tile rendered: ${meeting.exists}`);
    evidence(
      `iframe src ${meeting.src ? `set (${meeting.src.split("#")[0]})` : "EMPTY — JITSI_ENDPOINT unconfigured?"}`,
    );
    evidence(`disable-pointer while selected (expected true): ${meeting.disabled}`);
    // Deselect → iframe must become interactive.
    await deselect();
    await sleep(200);
    const afterDeselect = await page.evaluate(() => {
      const room = document.getElementById("meeting-room");
      return room?.classList.contains("disable-pointer") ?? true;
    });
    check(!afterDeselect, "meeting iframe becomes interactive after deselecting the tile");
  }

  // ---------------------------------------------------------------------
  // Cleanup: remove everything this run placed (board objects + the saved
  // drawing) so the test stage doesn't accumulate clutter across runs.
  // ---------------------------------------------------------------------
  await page.evaluate(
    ([ids]) => {
      const stage = window.__UPSTAGE_PINIA__.stage;
      stage.board.objects.filter((o) => !ids.includes(o.id)).forEach((o) => stage.deleteObject(o));
      const drawings = stage.board.drawings ?? [];
      const last = drawings[drawings.length - 1];
      if (last?.drawingId) stage.POP_DRAWING(last.drawingId);
    },
    [[...initialIds]],
  );
  await sleep(500);
} finally {
  await browser.close();
}

if (failures) {
  console.error(`[touch-stage] ${failures} check(s) FAILED`);
  process.exit(1);
}
log("all checks passed");
