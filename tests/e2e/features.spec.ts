/**
 * Stage features that perform.spec.ts deliberately does NOT exercise:
 *
 *   1. Drawing (drawn-on-stage, saved as a prop)
 *   2. Drawing saved as an avatar (toolbox + holdable avatar object)
 *   3. Opacity changes propagating over MQTT to a non-cast observer
 *   4. Depth (z-order via `stage.bringToFrontOf`) propagating to observers
 *
 * Each test:
 *   • Drives the admin seat via `__UPSTAGE_PINIA__.stage` (the same dev hook
 *     perform.spec.ts uses; the underlying calls are exactly what the
 *     SPA itself runs after a real toolbox click / pointer drag).
 *   • Asserts the cross-client contract on a separate, unauthenticated
 *     audience seat (board.objects + DOM where reasonable).
 *   • Cleans up its own placements so tests can run in any order or
 *     individually via `--grep`.
 *
 * Why not drive the toolbox UI:
 *   • The drawing toolbox is admin-only and the canvas pointer-drag is
 *     timing-fragile in headless. The bug we'd catch with pointer events
 *     (HTML5 canvas wiring in src/components/stage/Toolboxs/tools/Draw)
 *     is unrelated to the cross-client contract this spec is asserting.
 *   • perform.spec.ts already proved (with screenshots and bubble assertions)
 *     that the dev-hook path matches the production click path.
 *
 * Headed pacing:
 *   When run headed (the default for `pnpm e2e:features`), each step pauses
 *   long enough that an operator can actually SEE what's happening — the
 *   drawings are large and bright, a banner is overlaid identifying the
 *   current beat, and a settle delay sits between operations. In CI /
 *   headless the pace collapses to ~0 to keep wall-clock low. Override
 *   with `E2E_PACE=fast|normal|slow`.
 */

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { v4 as uuidv4 } from "uuid";

import { ADMIN } from "./personas";
import { LoginPage } from "./pages/LoginPage";
import { LiveStagePage } from "./pages/LiveStagePage";
import { readRuntime, type RuntimeState } from "./fixtures/runtime";
import { loadE2eConfig } from "./e2e-config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.join(__dirname, "..", "..", "test-results", "features");

interface BoardObject {
  id: string;
  type?: string;
  drawingId?: string;
  opacity?: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  name?: string;
  holder?: unknown;
  [k: string]: unknown;
}

interface AdminSeat {
  context: BrowserContext;
  page: Page;
  live: LiveStagePage;
  loginPage: LoginPage;
}

interface AudienceSeat {
  context: BrowserContext;
  page: Page;
  live: LiveStagePage;
}

const POLL_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------
type PaceKind = "fast" | "normal" | "slow";

function resolvePace(): PaceKind {
  const explicit = process.env.E2E_PACE?.trim().toLowerCase();
  if (explicit === "fast" || explicit === "normal" || explicit === "slow") {
    return explicit;
  }
  return loadE2eConfig().headless ? "fast" : "slow";
}

const PACE = resolvePace();

/**
 * Pause length in ms between visible beats. Tuned so a human watching the
 * play can register each event, while CI / headless still completes the
 * suite in well under a minute.
 */
function beatPauseMs(kind: "settle" | "between-tests" | "post-screenshot"): number {
  if (PACE === "fast") return 0;
  const slowMs = { settle: 1500, "between-tests": 2500, "post-screenshot": 800 }[kind];
  const normalMs = Math.round(slowMs * 0.4);
  return PACE === "normal" ? normalMs : slowMs;
}

async function settle(
  page: Page,
  kind: Parameters<typeof beatPauseMs>[0] = "settle",
): Promise<void> {
  const ms = beatPauseMs(kind);
  if (ms > 0) await page.waitForTimeout(ms);
}

/**
 * Generic poll-until-predicate. We use this rather than `page.waitForFunction`
 * for state we already pull through `getStageState` because this lets us
 * run the predicate against the *snapshot* the helper returns and write
 * tighter assertion failures (the snapshot is logged on timeout).
 */
async function pollUntil<T>(
  label: string,
  fetch: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = POLL_TIMEOUT_MS,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await fetch();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `[features] timed out waiting for: ${label}\n` +
      `  last value: ${JSON.stringify(last, null, 2)?.slice(0, 800)}`,
  );
}

/**
 * Build a synthetic `addDrawing` payload. We hand-build the canvas commands
 * (a thick, multi-color star) because the in-product flow is mouse → useDrawable →
 * `history` → save; we shortcut directly to the saved shape.
 *
 * Coordinates are absolute relative to the stage (Board.vue uses absolute
 * coordinates that get scaled per-client by Object.vue). The drawing is
 * deliberately oversized (default 400×400) and uses a thick stroke + bright
 * color so it's unmistakable when the test runs headed — the user reported
 * they couldn't see drawings whizzing past, and the original 100×100 red
 * triangle was easy to miss against the stage background.
 */
function buildDrawingPayload(opts: {
  drawingId: string;
  type: "avatar" | "prop";
  x: number;
  y: number;
  w?: number;
  h?: number;
  color?: string;
  size?: number;
  shape?: "star" | "triangle";
}): Record<string, unknown> & { drawingId: string } {
  const { drawingId, type, x, y } = opts;
  const w = opts.w ?? 400;
  const h = opts.h ?? 400;
  const color = opts.color ?? "#ff2266";
  const size = opts.size ?? 18;
  const shape = opts.shape ?? "star";
  const original = { x, y, w, h };

  // useDrawable's history items are objects with type + size + color +
  // lines[]; Drawing.vue → useRelativeCommands subtracts `original.{x,y}`
  // from each line coordinate, so we use absolute (x + offset) coords here.
  const points: Array<{ x: number; y: number }> = (() => {
    if (shape === "triangle") {
      return [
        { x: x + w / 2, y: y + h * 0.1 },
        { x: x + w * 0.9, y: y + h * 0.9 },
        { x: x + w * 0.1, y: y + h * 0.9 },
        { x: x + w / 2, y: y + h * 0.1 },
      ];
    }
    // 5-point star — visually bold, exercises multiple line segments.
    const cx = x + w / 2;
    const cy = y + h / 2;
    const outer = Math.min(w, h) * 0.45;
    const inner = outer * 0.42;
    const out: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 10; i += 1) {
      const r = i % 2 === 0 ? outer : inner;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      out.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    }
    return out;
  })();

  const lines: Array<{ fromX: number; fromY: number; x: number; y: number }> = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    lines.push({
      fromX: points[i].x,
      fromY: points[i].y,
      x: points[i + 1].x,
      y: points[i + 1].y,
    });
  }
  const commands = [
    {
      type: "draw",
      size,
      color,
      x: points[0].x,
      y: points[0].y,
      lines,
    },
  ];
  return {
    drawingId,
    type,
    x,
    y,
    w,
    h,
    original,
    commands,
  };
}

// ---------------------------------------------------------------------------
// Page banner — overlay identifying the current beat so a human watching
// can tell what's happening on screen. No-op in headless / fast mode.
// ---------------------------------------------------------------------------
async function showBanner(page: Page, text: string, sub = ""): Promise<void> {
  if (PACE === "fast") return;
  await page.evaluate(
    ({ text, sub }) => {
      const id = "__features-banner__";
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        Object.assign(el.style, {
          position: "fixed",
          top: "12px",
          left: "50%",
          transform: "translateX(-50%)",
          padding: "10px 18px",
          background: "rgba(20, 20, 35, 0.92)",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
          fontSize: "16px",
          fontWeight: "600",
          borderRadius: "8px",
          zIndex: "999999",
          pointerEvents: "none",
          boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
          maxWidth: "70vw",
          textAlign: "center",
        });
        document.body.appendChild(el);
      }
      el.innerHTML = `<div>${text}</div>${
        sub
          ? `<div style="font-size:13px;font-weight:400;opacity:0.8;margin-top:3px">${sub}</div>`
          : ""
      }`;
    },
    { text, sub },
  );
}

async function clearBanner(page: Page): Promise<void> {
  if (PACE === "fast") return;
  await page.evaluate(() => {
    document.getElementById("__features-banner__")?.remove();
  });
}

async function openAudience(browser: Browser, runtime: RuntimeState): Promise<AudienceSeat> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const live = new LiveStagePage(page);
  await live.goto(runtime.stageSlug);

  // Wait for MQTT joinStage to complete — same pattern perform.spec.ts uses.
  // Without this the audience can be subscribed *after* the admin's first
  // call lands on the broker and miss the message entirely.
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
    timeout: 30_000,
  });

  // Dismiss the LoginPrompt modal so the board is interactable for headed
  // viewers. Best-effort; perform.spec.ts has the canonical implementation
  // with retries — here we accept a simpler version because no test step
  // depends on clicking through the audience UI.
  const loginModal = page.locator(".modal.is-active").first();
  if (await loginModal.isVisible().catch(() => false)) {
    await loginModal
      .locator(".modal-background")
      .first()
      .click({ force: true, timeout: 3_000 })
      .catch(() => {});
  }
  return { context, page, live };
}

async function openAdmin(browser: Browser, runtime: RuntimeState): Promise<AdminSeat> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const loginPage = new LoginPage(page);
  await loginPage.login(ADMIN.username, ADMIN.password);
  const live = new LiveStagePage(page);
  await live.goto(runtime.stageSlug);
  return { context, page, live, loginPage };
}

/**
 * Place a prop on stage from the admin seat using the same dev-hook path
 * perform.spec.ts uses for avatars. Returns the placed object id so the
 * caller can drive subsequent shape/order operations against it.
 */
async function placeProp({
  admin,
  runtime,
  propKey,
  to,
  size,
}: {
  admin: AdminSeat;
  runtime: RuntimeState;
  propKey: string;
  to: { x: number; y: number };
  size?: { w: number; h: number };
}): Promise<string> {
  const ref = runtime.props[propKey];
  if (!ref) {
    throw new Error(
      `[features] runtime.props.${propKey} is missing — re-run pnpm e2e:setup ` +
        `(or pick a different prop key from runtime.json).`,
    );
  }
  return admin.page.evaluate(
    async ({ mediaId, mediaName, to, size }) => {
      type ToolboxProp = {
        id: string | number;
        name?: string;
        src?: string;
        assetType?: { name: string };
      };
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        tools: { props: ToolboxProp[] };
        board: { objects: Array<{ id: string }> };
        placeObjectOnStage: (p: unknown) => { id: string };
        shapeObject: (p: unknown) => unknown | Promise<unknown>;
      };

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      let prop: ToolboxProp | undefined;
      // Toolbox seeds from GraphQL; on a fresh load the props array can be
      // briefly empty. Poll for ~10s rather than racing.
      for (let i = 0; i < 40; i += 1) {
        const candidates = stage.tools.props ?? [];
        prop =
          candidates.find((p) => p.name === mediaName) ??
          candidates.find((p) => String(p.id) === String(mediaId));
        if (prop) break;
        await sleep(250);
      }
      if (!prop) {
        const ids = (stage.tools.props ?? []).map((p) => String(p.id)).join(",");
        throw new Error(`prop ${mediaName} (${mediaId}) not in toolbox; known ids: [${ids}]`);
      }

      const placed = stage.placeObjectOnStage({
        ...prop,
        name: mediaName,
        x: to.x,
        y: to.y,
        ...(size ? { w: size.w, h: size.h } : {}),
      });

      // Mirror perform.spec.ts: a follow-up shapeObject(liveAction) is what
      // the SPA fires after a real drag-end so observers actually see
      // the placement land on their board.
      const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
      if (!fromBoard) throw new Error("placeObjectOnStage did not push into board.objects");
      await Promise.resolve(
        stage.shapeObject({
          ...fromBoard,
          liveAction: true,
          published: false,
        }),
      );
      return placed.id;
    },
    { mediaId: ref.id, mediaName: ref.name, to, size: size ?? null },
  );
}

/**
 * Publish a locally-placed object so observers actually see it.
 *
 * `placeObjectOnStage` (and therefore `addDrawing`, which wraps it) only
 * mutates the placer's local store — there is NO MQTT broadcast in that
 * action. The "go live" publish is a separate `shapeObject` call with
 * `liveAction: true, published: false`, which is exactly what the SPA's
 * QuickAction "go live" button does (and what Moveable's drag-end fires
 * for already-live objects). `serializeWithoutLoading` in store/reusable.ts
 * also filters by `o.liveAction`, so non-published objects never reach
 * recordings either.
 *
 * `placeProp()` above bakes this follow-up in. For drawings we have to
 * call this helper after `addDrawing` because Draw/index.vue's `save()`
 * (the production path) also calls just `addDrawing` — meaning a
 * freshly-saved drawing is ALSO local-only until the admin clicks the
 * QuickAction toggle. That's by design; tests just have to mirror it.
 */
async function publishObject(admin: AdminSeat, objectId: string): Promise<void> {
  await admin.page.evaluate(async (id) => {
    const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
      board: { objects: Array<{ id: string } & Record<string, unknown>> };
      shapeObject: (p: unknown) => unknown | Promise<unknown>;
    };
    const obj = stage.board.objects.find((o) => o.id === id);
    if (!obj) throw new Error(`publishObject: ${id} not found in admin board.objects`);
    await Promise.resolve(
      stage.shapeObject({
        ...obj,
        liveAction: true,
        published: false,
      }),
    );
  }, objectId);
}

/**
 * Add a drawing on the admin seat and publish it. Returns the placed
 * object id (NOT the drawingId — placeObjectOnStage assigns a fresh uuid).
 */
async function addAndPublishDrawing(
  admin: AdminSeat,
  payload: Record<string, unknown> & { drawingId: string },
): Promise<string> {
  await admin.live.callStageAction("addDrawing", payload);
  const placedId = await admin.page.evaluate((drawingId) => {
    const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
      board: { objects: Array<{ id: string; drawingId?: string }> };
    };
    const placed = stage.board.objects.find((o) => o.drawingId === drawingId);
    if (!placed) throw new Error(`addDrawing: no board object with drawingId=${drawingId}`);
    return placed.id;
  }, payload.drawingId);
  await publishObject(admin, placedId);
  return placedId;
}

async function deleteObjectAdmin(admin: AdminSeat, objectId: string): Promise<void> {
  await admin.page.evaluate(async (id) => {
    const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
      board: { objects: Array<{ id: string }> };
      deleteObject: (p: unknown) => unknown | Promise<unknown>;
    };
    const obj = stage.board.objects.find((o) => o.id === id);
    if (obj) {
      await Promise.resolve(stage.deleteObject(obj));
    }
  }, objectId);
}

async function popDrawingAdmin(admin: AdminSeat, drawingId: string): Promise<void> {
  await admin.page.evaluate((id) => {
    const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
      POP_DRAWING: (p: unknown) => void;
    };
    stage.POP_DRAWING(id);
  }, drawingId);
}

/**
 * Wipe the admin's `board.objects` (which broadcasts a DESTROY for each
 * over MQTT and propagates to the audience). Used in `beforeAll` to clear
 * orphan objects left by prior failed runs (since failed tests bail
 * before reaching their per-test cleanup), and after each test to make
 * the next one start from a known board.
 *
 * We also POP_DRAWING for each object that has a `drawingId` so the
 * drawings tray ends up empty too — `deleteObject` only removes the
 * board object, not the tray entry.
 */
async function cleanBoard(admin: AdminSeat, audience: AudienceSeat): Promise<void> {
  const beforeIds = await admin.page.evaluate(async () => {
    type Obj = { id: string; drawingId?: string };
    const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
      board: { objects: Obj[]; drawings: Array<{ drawingId: string }> };
      deleteObject: (p: unknown) => unknown | Promise<unknown>;
      POP_DRAWING: (p: unknown) => void;
    };
    const objects = [...stage.board.objects];
    for (const obj of objects) {
      await Promise.resolve(stage.deleteObject(obj));
    }
    for (const d of [...stage.board.drawings]) {
      stage.POP_DRAWING(d.drawingId);
    }
    return objects.map((o) => o.id);
  });
  if (beforeIds.length === 0) return;
  // Wait until the audience has caught up (DESTROY round-trips through MQTT).
  await pollUntil<BoardObject[]>(
    `audience board cleared (had ${beforeIds.length} objects)`,
    async () => (await audience.live.getStageState<BoardObject[]>("board.objects")) ?? [],
    (objs) => beforeIds.every((id) => !objs.some((o) => o.id === id)),
  );
}

// ---------------------------------------------------------------------------

test.describe("features: drawing + opacity + depth @features", () => {
  test.describe.configure({ mode: "serial" });
  // Slow pacing extends each test to multiple seconds; bump the budget so
  // the suite never times out a watchable run.
  test.setTimeout(PACE === "slow" ? 10 * 60_000 : 5 * 60_000);

  let admin: AdminSeat;
  let audience: AudienceSeat;
  let runtime: RuntimeState;

  test.beforeAll(async ({ browser }) => {
    runtime = readRuntime();
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    admin = await openAdmin(browser, runtime);
    audience = await openAudience(browser, runtime);
    // Stage may carry orphans from prior runs that bailed before cleanup —
    // wipe so each test sees a deterministic starting board.
    await cleanBoard(admin, audience);
    console.log(
      `[features] seats ready (pace=${PACE}): stage=${runtime.stageSlug} ` +
        `props=${Object.keys(runtime.props).join(",")}`,
    );
  });

  // Defense-in-depth: even if a per-test cleanup is skipped (e.g. an
  // assertion threw before the cleanup line), the next test starts clean.
  test.afterEach(async () => {
    try {
      await clearBanner(admin.page);
      await clearBanner(audience.page);
      await cleanBoard(admin, audience);
    } catch (err) {
      console.warn(
        `[features] afterEach cleanBoard failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    // Visible breath between tests so a human watching can tell where one
    // beat ends and the next begins.
    await settle(audience.page, "between-tests");
  });

  test.afterAll(async () => {
    await admin?.context.close().catch(() => {});
    await audience?.context.close().catch(() => {});
  });

  // ---------------------------------------------------------------------
  // 1. Drawing — admin saves a drawing as a prop; audience sees the placed
  //    object (with `drawingId`) on their board and the rendered <canvas>.
  //
  //    The drawing is a 400x400 bright pink star centered on the stage so
  //    a human watching headed can actually SEE it appear.
  // ---------------------------------------------------------------------
  test("drawing saved as prop appears on audience board", async () => {
    await showBanner(
      admin.page,
      "Test 1 — Drawing as prop",
      "drawing a bright pink star (admin side)",
    );
    await showBanner(
      audience.page,
      "Test 1 — Drawing as prop",
      "watching for the star to appear (audience side)",
    );
    await settle(admin.page);

    const drawingId = uuidv4();
    const payload = buildDrawingPayload({
      drawingId,
      type: "prop",
      x: 300,
      y: 200,
      w: 400,
      h: 400,
      color: "#ff2266",
      size: 18,
      shape: "star",
    });

    const placedId = await addAndPublishDrawing(admin, payload);

    const objects = await pollUntil<BoardObject[]>(
      `audience board has drawing ${drawingId}`,
      async () => (await audience.live.getStageState<BoardObject[]>("board.objects")) ?? [],
      (objs) => objs.some((o) => o.drawingId === drawingId),
    );
    const placed = objects.find((o) => o.drawingId === drawingId)!;
    // addDrawing → placeObjectOnStage spreads the drawing payload first
    // and lets the action's defaults (w/h/opacity/...) backfill anything
    // missing. drawing.type is preserved as "prop".
    expect(placed.type).toBe("prop");
    expect(placed.id).toBe(placedId);
    expect(placed.id).not.toBe(drawingId); // placeObjectOnStage assigns a fresh uuid

    // Drawing.vue mounts a <canvas> inside the AppObject's render slot.
    // Object.vue's wrapper carries :data-object-id, so we can scope the
    // canvas lookup to the specific drawing rather than any drawing on
    // the board (relevant once future tests don't tear down between runs).
    const wrapper = audience.page.locator(`[data-object-id="${placed.id}"]`).first();
    await expect(wrapper).toBeVisible({ timeout: 5_000 });
    const canvas = wrapper.locator("canvas").first();
    await expect(canvas).toBeVisible({ timeout: 5_000 });

    // Stronger render assertion: useDrawing draws strokes onto the canvas
    // bitmap on mount + every drawing-prop change. If the commands list
    // was empty or malformed, the bitmap would be all-transparent (pixel
    // data == 0). Sample the bitmap and require at least *some* non-zero
    // alpha pixels — that's the smallest credible "the strokes actually
    // hit the canvas" assertion we can write without fixture images.
    const nonZeroAlphaPixels = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext("2d");
      if (!ctx || !c.width || !c.height) return 0;
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let nonZero = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) nonZero += 1;
      }
      return nonZero;
    });
    expect(nonZeroAlphaPixels).toBeGreaterThan(100);

    // Settle so a human can register the drawing onscreen, then take
    // screenshots from BOTH seats so post-mortem inspection is easy.
    await settle(audience.page);
    await audience.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "drawing-prop-audience.png"),
      fullPage: false,
    });
    await admin.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "drawing-prop-admin.png"),
      fullPage: false,
    });
    await settle(audience.page, "post-screenshot");

    await deleteObjectAdmin(admin, placed.id);
    await popDrawingAdmin(admin, drawingId);
  });

  // ---------------------------------------------------------------------
  // 2. Drawing-as-avatar — same addDrawing path with type=avatar. Verifies
  //    the audience-side object is `type: "avatar"` AND that admin's local
  //    side wired itself up as the holder (placeObjectOnStage's avatar
  //    branch dispatches user/setAvatarId for the placer).
  // ---------------------------------------------------------------------
  test("drawing saved as avatar produces a holdable avatar object", async () => {
    await showBanner(
      admin.page,
      "Test 2 — Drawing as avatar",
      "drawing a teal triangle that becomes a holdable avatar",
    );
    await showBanner(audience.page, "Test 2 — Drawing as avatar", "watching the avatar appear");
    await settle(admin.page);

    const drawingId = uuidv4();
    const payload = buildDrawingPayload({
      drawingId,
      type: "avatar",
      x: 350,
      y: 200,
      w: 350,
      h: 350,
      color: "#1aa899",
      size: 20,
      shape: "triangle",
    });

    const placedId = await addAndPublishDrawing(admin, payload);

    const objects = await pollUntil<BoardObject[]>(
      `audience board has avatar drawing ${drawingId}`,
      async () => (await audience.live.getStageState<BoardObject[]>("board.objects")) ?? [],
      (objs) => objs.some((o) => o.drawingId === drawingId),
    );
    const placed = objects.find((o) => o.drawingId === drawingId)!;
    expect(placed.type).toBe("avatar");
    expect(placed.id).toBe(placedId);

    // Admin should now hold this avatar. After Phase 5 the avatarId lives
    // in Pinia, exposed via `__UPSTAGE_PINIA__.user`.
    const heldId = await admin.page.evaluate(
      () => (window.__UPSTAGE_PINIA__!.user.avatarId as string | number | null) ?? null,
    );
    expect(heldId).toBe(placed.id);

    await settle(audience.page);
    await audience.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "drawing-avatar-audience.png"),
      fullPage: false,
    });
    await admin.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "drawing-avatar-admin.png"),
      fullPage: false,
    });
    await settle(audience.page, "post-screenshot");

    await deleteObjectAdmin(admin, placed.id);
    await popDrawingAdmin(admin, drawingId);
  });

  test("releasing an avatar clears holder teardrop on all clients", async () => {
    await showBanner(admin.page, "Test 2b — Release avatar", "placing then releasing an avatar");
    await showBanner(audience.page, "Test 2b — Release avatar", "watching teardrop clear");
    await settle(admin.page);

    const avatarKey = Object.keys(runtime.mediaByPersona)[0];
    if (!avatarKey) test.skip(true, "runtime.json has no avatars — re-run pnpm e2e:setup");

    const avatarRef = runtime.mediaByPersona[avatarKey];
    const placedId = await admin.page.evaluate(
      async ({ mediaId, mediaName, to }) => {
        type ToolboxAvatar = {
          id: string | number;
          name?: string;
          src?: string;
          type?: string;
        };
        const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
          tools: { avatars: ToolboxAvatar[] };
          board: { objects: Array<{ id: string }> };
          placeObjectOnStage: (p: unknown) => { id: string };
          shapeObject: (p: unknown) => unknown | Promise<unknown>;
        };

        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        let avatar: ToolboxAvatar | undefined;
        for (let i = 0; i < 40; i += 1) {
          const candidates = stage.tools.avatars ?? [];
          avatar =
            candidates.find((a) => a.name === mediaName) ??
            candidates.find((a) => String(a.id) === String(mediaId));
          if (avatar) break;
          await sleep(250);
        }
        if (!avatar) {
          throw new Error(`avatar ${mediaName} (${mediaId}) not in toolbox`);
        }

        const placed = stage.placeObjectOnStage({
          ...avatar,
          type: "avatar",
          name: mediaName,
          x: to.x,
          y: to.y,
        });
        const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
        if (!fromBoard) throw new Error("placeObjectOnStage did not push into board.objects");
        await Promise.resolve(
          stage.shapeObject({
            ...fromBoard,
            liveAction: true,
            published: false,
          }),
        );
        return placed.id;
      },
      { mediaId: avatarRef.id, mediaName: avatarRef.name, to: { x: 300, y: 280 } },
    );

    await admin.page.evaluate((id) => {
      window.__UPSTAGE_PINIA__!.user.setAvatarId(id);
    }, placedId);

    await pollUntil<BoardObject[]>(
      `audience sees holder for avatar ${placedId}`,
      async () => (await audience.live.getStageState<BoardObject[]>("objects")) ?? [],
      (objs) => {
        const o = objs.find((x) => x.id === placedId);
        return Boolean(o?.holder);
      },
    );

    await admin.page.evaluate(() => {
      window.__UPSTAGE_PINIA__!.stage.releaseAvatarHold();
    });

    await pollUntil<BoardObject[]>(
      `admin board clears holder for avatar ${placedId}`,
      async () => (await admin.live.getStageState<BoardObject[]>("objects")) ?? [],
      (objs) => {
        const o = objs.find((x) => x.id === placedId);
        return Boolean(o && !o.holder);
      },
    );

    await pollUntil<BoardObject[]>(
      `audience board clears holder for avatar ${placedId}`,
      async () => (await audience.live.getStageState<BoardObject[]>("objects")) ?? [],
      (objs) => {
        const o = objs.find((x) => x.id === placedId);
        return Boolean(o && !o.holder);
      },
    );

    await deleteObjectAdmin(admin, placedId);
  });

  // ---------------------------------------------------------------------
  // 3. Opacity — the OpacitySlider component calls `stage.shapeObject`
  //    with a new opacity. Verify that change reaches the audience seat
  //    in both store state AND the rendered DOM (Object.vue binds opacity
  //    via :style="{ opacity: object.opacity }").
  // ---------------------------------------------------------------------
  test("opacity change on a placed prop propagates to observers", async () => {
    await showBanner(admin.page, "Test 3 — Opacity", "placing a prop, then dialing it down to 30%");
    await showBanner(audience.page, "Test 3 — Opacity", "watching the prop fade");
    await settle(admin.page);

    const propKey = Object.keys(runtime.props)[0];
    if (!propKey) test.skip(true, "runtime.json has no props — re-run pnpm e2e:setup");

    const placedId = await placeProp({
      admin,
      runtime,
      propKey,
      to: { x: 350, y: 350 },
      // Make the prop nice and large so the opacity change is unmistakable
      // when watching headed. Default 100×100 was easy to overlook.
      size: { w: 280, h: 280 },
    });

    // Confirm placement reached the audience (and default opacity is 1).
    await pollUntil<BoardObject[]>(
      `audience board has prop ${placedId}`,
      async () => (await audience.live.getStageState<BoardObject[]>("board.objects")) ?? [],
      (objs) => {
        const o = objs.find((x) => x.id === placedId);
        return Boolean(o && (o.opacity ?? 1) > 0.95);
      },
    );

    // Settle at full opacity so the contrast with the dimmed state below
    // is visible to a human watching.
    await settle(audience.page);

    // Drive the opacity change the same way OpacitySlider.vue does:
    // shapeObject({...object, opacity: 0.3}). No `liveAction` flag here —
    // OpacitySlider's `sendChangeOpacity` doesn't set one either; the
    // shapeObject action's non-liveAction branch broadcasts an UPDATE
    // BOARD message that audience receives via handleBoardMessage.
    await admin.page.evaluate(async (id) => {
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        board: { objects: Array<{ id: string } & Record<string, unknown>> };
        shapeObject: (p: unknown) => unknown | Promise<unknown>;
      };
      const obj = stage.board.objects.find((o) => o.id === id);
      if (!obj) throw new Error(`admin lost track of object ${id} before opacity dispatch`);
      await Promise.resolve(stage.shapeObject({ ...obj, opacity: 0.3 }));
    }, placedId);

    const settled = await pollUntil<BoardObject[]>(
      `audience opacity ≈ 0.3 for ${placedId}`,
      async () => (await audience.live.getStageState<BoardObject[]>("board.objects")) ?? [],
      (objs) => {
        const o = objs.find((x) => x.id === placedId);
        if (!o || o.opacity == null) return false;
        return Math.abs(Number(o.opacity) - 0.3) < 0.05;
      },
    );
    const audienceObj = settled.find((o) => o.id === placedId)!;
    expect(audienceObj.opacity).toBeCloseTo(0.3, 1);

    // DOM check: Object.vue's wrapper carries `:data-object-id="object.id"`,
    // but the actual opacity binding lives on its PARENT — Moveable.vue's
    // outer <div ref="el"> sets `opacity: object.opacity * (isDragging ? 0.5
    // : 1)` (see src/components/objects/Moveable.vue). CSS `opacity` does
    // NOT cascade through getComputedStyle (each element has its own
    // computed value, default 1), so we must read from the parent div.
    //
    // Use expect.poll because a global stylesheet animates opacity over a
    // short transition: a single read can sample mid-transition (~0.98 →
    // ~0.36) rather than the settled value (0.3). expect.poll is
    // Playwright's idiomatic retry-until-predicate-true assertion;
    // the threshold is `≈ 0.3` (within 0.05), matching the Vuex tolerance.
    const wrapper = audience.page.locator(`[data-object-id="${placedId}"]`).first();
    await expect(wrapper).toBeVisible({ timeout: 5_000 });
    const readComputedOpacity = async () =>
      wrapper.evaluate((el) => {
        const parent = (el as HTMLElement).parentElement;
        if (!parent) throw new Error("data-object-id wrapper has no parent (Moveable host)");
        return Number(getComputedStyle(parent).opacity);
      });
    await expect
      .poll(readComputedOpacity, { timeout: 10_000, intervals: [100, 200, 500] })
      .toBeCloseTo(0.3, 1);

    await settle(audience.page);
    await audience.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "opacity-audience.png"),
      fullPage: false,
    });
    await admin.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "opacity-admin.png"),
      fullPage: false,
    });
    await settle(audience.page, "post-screenshot");

    await deleteObjectAdmin(admin, placedId);
  });

  // ---------------------------------------------------------------------
  // 4. Depth — admin places three props, then dispatches bringToFrontOf to
  //    move the first prop in front of the third. BRING_TO_FRONT_OF moves
  //    the `front` object to immediately precede `back` in board.objects;
  //    audience should see the same final ordering.
  // ---------------------------------------------------------------------
  test("depth (bringToFrontOf) reorders board.objects on observers", async () => {
    await showBanner(
      admin.page,
      "Test 4 — Depth (z-order)",
      "placing 3 props, then bringing #1 in front of #3",
    );
    await showBanner(audience.page, "Test 4 — Depth (z-order)", "watching the layer order change");
    await settle(admin.page);

    const propKeys = Object.keys(runtime.props);
    if (propKeys.length < 1) {
      test.skip(true, "runtime.json has no props — re-run pnpm e2e:setup");
    }
    // Reuse the same prop three times; a single asset is enough since the
    // contract under test is positional, not visual. (If multiple distinct
    // props are present we use them; otherwise the same key drives all
    // three placements with different coordinates.)
    const k1 = propKeys[0];
    const k2 = propKeys[1] ?? propKeys[0];
    const k3 = propKeys[2] ?? propKeys[0];

    // Overlap them noticeably so the z-reorder is actually visible. Big
    // sizes + close coordinates = props clearly stacked on top of each
    // other.
    const id1 = await placeProp({
      admin,
      runtime,
      propKey: k1,
      to: { x: 250, y: 350 },
      size: { w: 220, h: 220 },
    });
    const id2 = await placeProp({
      admin,
      runtime,
      propKey: k2,
      to: { x: 380, y: 350 },
      size: { w: 220, h: 220 },
    });
    const id3 = await placeProp({
      admin,
      runtime,
      propKey: k3,
      to: { x: 510, y: 350 },
      size: { w: 220, h: 220 },
    });

    // Wait for audience to see all three in the [id1, id2, id3] order
    // (placeObjectOnStage appends to board.objects, so the placement
    // order IS the initial z-order).
    await pollUntil<BoardObject[]>(
      "audience board has [id1, id2, id3] in placement order",
      async () => (await audience.live.getStageState<BoardObject[]>("board.objects")) ?? [],
      (objs) => {
        const ids = objs.map((o) => o.id);
        const i1 = ids.indexOf(id1);
        const i2 = ids.indexOf(id2);
        const i3 = ids.indexOf(id3);
        return i1 >= 0 && i2 > i1 && i3 > i2;
      },
    );

    // Settle at the initial order so a watcher can register it before the
    // reorder lands.
    await settle(audience.page);

    // Dispatch the same action Skeleton.vue's drop handler fires.
    await admin.live.callStageAction("bringToFrontOf", { front: id1, back: id3 });

    // Trace BRING_TO_FRONT_OF on [id1, id2, id3] with front=id1, back=id3:
    //   1. splice(0, 1) removes id1 → state becomes [id2, id3] (length 2)
    //   2. splice(2, 0, id1) inserts at the now-end → [id2, id3, id1]
    // Net effect: front lands AFTER back. The action name reads as "bring
    // front in front of back" in the painter's-algorithm sense — higher
    // index = rendered on top = visually "in front" — but in array order
    // the moved element ends up immediately *after* the back element.
    const settled = await pollUntil<BoardObject[]>(
      "audience board reordered: id1 just after id3",
      async () => (await audience.live.getStageState<BoardObject[]>("board.objects")) ?? [],
      (objs) => {
        const ids = objs.map((o) => o.id);
        const i1 = ids.indexOf(id1);
        const i3 = ids.indexOf(id3);
        return i1 >= 0 && i3 >= 0 && i3 + 1 === i1;
      },
    );
    const settledIds = settled.map((o) => o.id);
    const i1 = settledIds.indexOf(id1);
    const i2 = settledIds.indexOf(id2);
    const i3 = settledIds.indexOf(id3);
    expect(i3 + 1).toBe(i1); // id1 immediately after id3 (rendered on top)
    expect(i2).toBeLessThan(i3); // id2 stayed earlier than both

    await settle(audience.page);
    await audience.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "depth-audience.png"),
      fullPage: false,
    });
    await admin.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "depth-admin.png"),
      fullPage: false,
    });
    await settle(audience.page, "post-screenshot");

    await deleteObjectAdmin(admin, id1);
    await deleteObjectAdmin(admin, id2);
    await deleteObjectAdmin(admin, id3);
  });

  // ---------------------------------------------------------------------
  // 5. Avatar holds — player-only, session-scoped, no orphans after delete
  //    or competing claims (including same account in two browser tabs).
  // ---------------------------------------------------------------------
  test("reconcileAvatarHolds keeps one winner per avatar and strips audience holds", async () => {
    const result = await admin.page.evaluate(() => {
      type SessionRow = {
        id: string;
        isPlayer?: boolean;
        avatarId?: string | null;
        at: number;
      };
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        sessions: SessionRow[];
        board: { objects: Array<{ id: string; type?: string }> };
        PUSH_OBJECT: (p: unknown) => void;
        UPDATE_SESSIONS_COUNTER: (s: SessionRow) => void;
        objects: Array<{ id: string; holder?: SessionRow }>;
      };

      // Isolate from live MQTT session rows (admin tab, stale holds).
      stage.sessions = [];

      const avatarId = "avatar-hold-reconcile-test";
      const now = Date.now();
      stage.PUSH_OBJECT({
        id: avatarId,
        type: "avatar",
        name: "Hold test",
        x: 120,
        y: 120,
        w: 120,
        h: 120,
      });

      stage.UPDATE_SESSIONS_COUNTER({
        id: "player-tab-a",
        isPlayer: true,
        at: now - 2000,
        avatarId,
      });
      stage.UPDATE_SESSIONS_COUNTER({
        id: "player-tab-b",
        isPlayer: true,
        at: now - 1000,
        avatarId,
      });
      stage.UPDATE_SESSIONS_COUNTER({
        id: "audience-tab",
        isPlayer: false,
        at: now,
        avatarId,
      });

      const sessions = stage.sessions;
      const tabA = sessions.find((s) => s.id === "player-tab-a");
      const tabB = sessions.find((s) => s.id === "player-tab-b");
      const audienceTab = sessions.find((s) => s.id === "audience-tab");
      const holder = stage.objects.find((o) => o.id === avatarId)?.holder;

      return {
        tabACleared: tabA?.avatarId == null,
        tabBWins: tabB?.avatarId === avatarId,
        audienceCleared: audienceTab?.avatarId == null,
        holderSessionId: holder?.id ?? null,
      };
    });

    expect(result.tabACleared).toBe(true);
    expect(result.tabBWins).toBe(true);
    expect(result.audienceCleared).toBe(true);
    expect(result.holderSessionId).toBe("player-tab-b");
  });

  test("audience cannot claim an avatar hold", async () => {
    const result = await audience.page.evaluate(() => {
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        canPlay: boolean;
        PUSH_OBJECT: (p: unknown) => void;
      };
      const user = window.__UPSTAGE_PINIA__!.user as unknown as {
        setAvatarId: (id: string | null) => void;
        avatarId: string | null;
      };

      const avatarId = "avatar-audience-hold-blocked";
      stage.PUSH_OBJECT({
        id: avatarId,
        type: "avatar",
        name: "Audience block",
        x: 80,
        y: 80,
        w: 100,
        h: 100,
      });

      user.setAvatarId(avatarId);

      return {
        canPlay: stage.canPlay,
        avatarId: user.avatarId,
      };
    });

    expect(result.canPlay).toBe(false);
    expect(result.avatarId).toBeNull();
  });

  test("deleting a held avatar clears holder on all clients", async () => {
    const avatarKey = Object.keys(runtime.mediaByPersona)[0];
    if (!avatarKey) test.skip(true, "runtime.json has no avatars — re-run pnpm e2e:setup");

    const avatarRef = runtime.mediaByPersona[avatarKey];
    const placedId = await admin.page.evaluate(
      async ({ mediaId, mediaName, to }) => {
        type ToolboxAvatar = {
          id: string | number;
          name?: string;
          src?: string;
          type?: string;
        };
        const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
          tools: { avatars: ToolboxAvatar[] };
          board: { objects: Array<{ id: string }> };
          placeObjectOnStage: (p: unknown) => { id: string };
          shapeObject: (p: unknown) => unknown | Promise<unknown>;
        };

        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
        let avatar: ToolboxAvatar | undefined;
        for (let i = 0; i < 40; i += 1) {
          const candidates = stage.tools.avatars ?? [];
          avatar =
            candidates.find((a) => a.name === mediaName) ??
            candidates.find((a) => String(a.id) === String(mediaId));
          if (avatar) break;
          await sleep(250);
        }
        if (!avatar) {
          throw new Error(`avatar ${mediaName} (${mediaId}) not in toolbox`);
        }

        const placed = stage.placeObjectOnStage({
          ...avatar,
          type: "avatar",
          name: mediaName,
          x: to.x,
          y: to.y,
        });
        const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
        if (!fromBoard) throw new Error("placeObjectOnStage did not push into board.objects");
        await Promise.resolve(
          stage.shapeObject({
            ...fromBoard,
            liveAction: true,
            published: false,
          }),
        );
        return placed.id;
      },
      { mediaId: avatarRef.id, mediaName: avatarRef.name, to: { x: 320, y: 260 } },
    );

    await admin.page.evaluate((id) => {
      window.__UPSTAGE_PINIA__!.user.setAvatarId(id);
    }, placedId);

    await pollUntil<BoardObject[]>(
      `audience sees holder for avatar ${placedId}`,
      async () => (await audience.live.getStageState<BoardObject[]>("objects")) ?? [],
      (objs) => Boolean(objs.find((x) => x.id === placedId)?.holder),
    );

    await deleteObjectAdmin(admin, placedId);

    await pollUntil<BoardObject[]>(
      `audience has no stale holder after avatar ${placedId} deleted`,
      async () => (await audience.live.getStageState<BoardObject[]>("board.objects")) ?? [],
      (objs) => {
        const o = objs.find((x) => x.id === placedId);
        return o == null;
      },
    );

    const staleSessionHold = await admin.page.evaluate(() => {
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        sessions: Array<{ avatarId?: string | null }>;
      };
      return stage.sessions.some((s) => s.avatarId != null && s.avatarId !== "");
    });
    expect(staleSessionHold).toBe(false);
  });

  test("losing tab clears local avatarId when another session claims the same avatar", async () => {
    const result = await admin.page.evaluate(() => {
      type SessionRow = {
        id: string;
        isPlayer?: boolean;
        avatarId?: string | null;
        at: number;
        userId?: string | number | null;
      };
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        session: string | null;
        sessions: SessionRow[];
        board: { objects: Array<{ id: string; type?: string }> };
        PUSH_OBJECT: (p: unknown) => void;
        UPDATE_SESSIONS_COUNTER: (s: SessionRow) => void;
      };
      const user = window.__UPSTAGE_PINIA__!.user as unknown as {
        avatarId: string | null;
        currentUserId?: string | number;
        $patch: (p: { avatarId: string | null }) => void;
      };

      const avatarId = "avatar-same-account-tab-fight";
      stage.PUSH_OBJECT({
        id: avatarId,
        type: "avatar",
        name: "Tab fight",
        x: 200,
        y: 200,
        w: 100,
        h: 100,
      });

      const now = Date.now();
      stage.session = "local-tab-a";
      user.$patch({ avatarId });
      stage.UPDATE_SESSIONS_COUNTER({
        id: "local-tab-a",
        isPlayer: true,
        userId: user.currentUserId ?? "same-user",
        at: now - 2000,
        avatarId,
      });

      stage.UPDATE_SESSIONS_COUNTER({
        id: "local-tab-b",
        isPlayer: true,
        userId: user.currentUserId ?? "same-user",
        at: now - 1000,
        avatarId,
      });

      return {
        localAvatarId: user.avatarId,
        localSession: stage.session,
        winner: stage.sessions.find((s) => s.avatarId === avatarId)?.id ?? null,
      };
    });

    expect(result.localSession).toBe("local-tab-a");
    expect(result.localAvatarId).toBeNull();
    expect(result.winner).toBe("local-tab-b");
  });

  test("reconcileAvatarHolds keeps one hold per userId across different avatars", async () => {
    const result = await admin.page.evaluate(() => {
      type SessionRow = {
        id: string;
        isPlayer?: boolean;
        avatarId?: string | null;
        at: number;
        userId?: string | number | null;
      };
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        sessions: SessionRow[];
        board: { objects: Array<{ id: string; type?: string }> };
        PUSH_OBJECT: (p: unknown) => void;
        UPDATE_SESSIONS_COUNTER: (s: SessionRow) => void;
        objects: Array<{ id: string; holder?: SessionRow }>;
      };

      const avatarA = "avatar-user-dedupe-a";
      const avatarB = "avatar-user-dedupe-b";
      const sharedUserId = "logged-in-user-42";

      stage.sessions = [];

      const now = Date.now();
      stage.PUSH_OBJECT({
        id: avatarA,
        type: "avatar",
        name: "A",
        x: 10,
        y: 10,
        w: 80,
        h: 80,
      });
      stage.PUSH_OBJECT({
        id: avatarB,
        type: "avatar",
        name: "B",
        x: 200,
        y: 10,
        w: 80,
        h: 80,
      });

      stage.UPDATE_SESSIONS_COUNTER({
        id: "tab-older",
        isPlayer: true,
        userId: sharedUserId,
        at: now - 2000,
        avatarId: avatarA,
      });
      stage.UPDATE_SESSIONS_COUNTER({
        id: "tab-newer",
        isPlayer: true,
        userId: sharedUserId,
        at: now - 1000,
        avatarId: avatarB,
      });

      const older = stage.sessions.find((s) => s.id === "tab-older");
      const newer = stage.sessions.find((s) => s.id === "tab-newer");
      const holderA = stage.objects.find((o) => o.id === avatarA)?.holder;
      const holderB = stage.objects.find((o) => o.id === avatarB)?.holder;

      return {
        olderCleared: older?.avatarId == null,
        newerHoldsB: newer?.avatarId === avatarB,
        holderAId: holderA?.id ?? null,
        holderBId: holderB?.id ?? null,
        holdingSessionCount: stage.sessions.filter(
          (s) => s.isPlayer && s.userId === sharedUserId && s.avatarId != null,
        ).length,
      };
    });

    expect(result.olderCleared).toBe(true);
    expect(result.newerHoldsB).toBe(true);
    expect(result.holderAId).toBeNull();
    expect(result.holderBId).toBe("tab-newer");
    expect(result.holdingSessionCount).toBe(1);
  });
});
