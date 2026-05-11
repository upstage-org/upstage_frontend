/**
 * Stage features that perform.spec.ts deliberately does NOT exercise:
 *
 *   1. Drawing (drawn-on-stage, saved as a prop)
 *   2. Drawing saved as an avatar (toolbox + holdable avatar object)
 *   3. Opacity changes propagating over MQTT to a non-cast observer
 *   4. Depth (z-order via stage/bringToFrontOf) propagating to observers
 *
 * Each test:
 *   • Drives the admin seat via `__UPSTAGE_STORE__` (the same dev hook
 *     perform.spec.ts uses; the underlying dispatches are exactly what the
 *     SPA itself runs after a real toolbox click / pointer drag).
 *   • Asserts the cross-client contract on a separate, unauthenticated
 *     audience seat (state.board.objects + DOM where reasonable).
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
 * (a small triangle) because the in-product flow is mouse → useDrawable →
 * `history` → save; we shortcut directly to the saved shape.
 *
 * Coordinates are absolute relative to the stage (Board.vue uses absolute
 * coordinates that get scaled per-client by Object.vue). 100×100 keeps
 * the drawing visible without dominating the audience board.
 */
function buildDrawingPayload(opts: {
  drawingId: string;
  type: "avatar" | "prop";
  x: number;
  y: number;
}): Record<string, unknown> & { drawingId: string } {
  const { drawingId, type, x, y } = opts;
  const w = 100;
  const h = 100;
  // useDrawable's history items are objects with type + size + color +
  // lines[]; Object.vue → SavedDrawing/Drawing.vue replays them via
  // useRelativeCommands which subtracts `original.{x,y}` from each line
  // coordinate, so we must include `original` matching x/y/w/h.
  const original = { x, y, w, h };
  const commands = [
    {
      type: "draw",
      size: 6,
      color: "#cc2222",
      x: x + 50,
      y: y + 10,
      lines: [
        { fromX: x + 50, fromY: y + 10, x: x + 90, y: y + 90 },
        { fromX: x + 90, fromY: y + 90, x: x + 10, y: y + 90 },
        { fromX: x + 10, fromY: y + 90, x: x + 50, y: y + 10 },
      ],
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

async function openAudience(browser: Browser, runtime: RuntimeState): Promise<AudienceSeat> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const live = new LiveStagePage(page);
  await live.goto(runtime.stageSlug);

  // Wait for MQTT joinStage to complete — same pattern perform.spec.ts uses.
  // Without this the audience can be subscribed *after* the admin's first
  // dispatch lands on the broker and miss the message entirely.
  await page.waitForFunction(
    () => {
      type DevStore = { state: { stage: { status: string } } };
      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      return store?.state?.stage?.status === "LIVE";
    },
    { timeout: 30_000 },
  );

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
}: {
  admin: AdminSeat;
  runtime: RuntimeState;
  propKey: string;
  to: { x: number; y: number };
}): Promise<string> {
  const ref = runtime.props[propKey];
  if (!ref) {
    throw new Error(
      `[features] runtime.props.${propKey} is missing — re-run pnpm e2e:setup ` +
        `(or pick a different prop key from runtime.json).`,
    );
  }
  return admin.page.evaluate(
    async ({ mediaId, mediaName, to }) => {
      type ToolboxProp = {
        id: string | number;
        name?: string;
        src?: string;
        assetType?: { name: string };
      };
      type DevStore = {
        dispatch: (t: string, p?: unknown) => Promise<unknown>;
        state: {
          stage: {
            tools: { props: ToolboxProp[] };
            board: { objects: Array<{ id: string }> };
          };
        };
      };
      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      if (!store) throw new Error("Vuex store not exposed.");

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      let prop: ToolboxProp | undefined;
      // Toolbox seeds from GraphQL; on a fresh load the props array can be
      // briefly empty. Poll for ~10s rather than racing.
      for (let i = 0; i < 40; i += 1) {
        const candidates = store.state.stage.tools.props ?? [];
        prop =
          candidates.find((p) => p.name === mediaName) ??
          candidates.find((p) => String(p.id) === String(mediaId));
        if (prop) break;
        await sleep(250);
      }
      if (!prop) {
        const ids = (store.state.stage.tools.props ?? []).map((p) => String(p.id)).join(",");
        throw new Error(`prop ${mediaName} (${mediaId}) not in toolbox; known ids: [${ids}]`);
      }

      const placed = (await store.dispatch("stage/placeObjectOnStage", {
        ...prop,
        name: mediaName,
        x: to.x,
        y: to.y,
      })) as { id: string };

      // Mirror perform.spec.ts: a follow-up shapeObject(liveAction) is what
      // the SPA fires after a real drag-end so observers actually see
      // the placement land on their board.
      const fromBoard = store.state.stage.board.objects.find((o) => o.id === placed.id);
      if (!fromBoard) throw new Error("placeObjectOnStage did not push into board.objects");
      await store.dispatch("stage/shapeObject", {
        ...fromBoard,
        liveAction: true,
        published: false,
      });
      return placed.id;
    },
    { mediaId: ref.id, mediaName: ref.name, to },
  );
}

/**
 * Publish a locally-placed object so observers actually see it.
 *
 * `placeObjectOnStage` (and therefore `addDrawing`, which wraps it) only
 * mutates the placer's local Vuex — there is NO MQTT broadcast in that
 * action. The "go live" publish is a separate `shapeObject` dispatch with
 * `liveAction: true, published: false`, which is exactly what the SPA's
 * QuickAction "go live" button does (and what Moveable's drag-end fires
 * for already-live objects). `serializeWithoutLoading` in store/reusable.ts
 * also filters by `o.liveAction`, so non-published objects never reach
 * recordings either.
 *
 * `placeProp()` above bakes this follow-up in. For drawings we have to
 * call this helper after `addDrawing` because Draw/index.vue's `save()`
 * (the production path) also dispatches just `addDrawing` — meaning a
 * freshly-saved drawing is ALSO local-only until the admin clicks the
 * QuickAction toggle. That's by design; tests just have to mirror it.
 */
async function publishObject(admin: AdminSeat, objectId: string): Promise<void> {
  await admin.page.evaluate(async (id) => {
    type DevStore = {
      dispatch: (t: string, p?: unknown) => Promise<unknown>;
      state: { stage: { board: { objects: Array<{ id: string } & Record<string, unknown>> } } };
    };
    const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
    if (!store) throw new Error("Vuex store not exposed.");
    const obj = store.state.stage.board.objects.find((o) => o.id === id);
    if (!obj) throw new Error(`publishObject: ${id} not found in admin board.objects`);
    await store.dispatch("stage/shapeObject", {
      ...obj,
      liveAction: true,
      published: false,
    });
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
  await admin.live.dispatchAction("stage/addDrawing", payload);
  const placedId = await admin.page.evaluate((drawingId) => {
    type DevStore = {
      state: { stage: { board: { objects: Array<{ id: string; drawingId?: string }> } } };
    };
    const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
    if (!store) throw new Error("Vuex store not exposed.");
    const placed = store.state.stage.board.objects.find((o) => o.drawingId === drawingId);
    if (!placed) throw new Error(`addDrawing: no board object with drawingId=${drawingId}`);
    return placed.id;
  }, payload.drawingId);
  await publishObject(admin, placedId);
  return placedId;
}

async function deleteObjectAdmin(admin: AdminSeat, objectId: string): Promise<void> {
  await admin.page.evaluate(async (id) => {
    type DevStore = {
      dispatch: (t: string, p?: unknown) => Promise<unknown>;
      state: { stage: { board: { objects: Array<{ id: string }> } } };
    };
    const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
    if (!store) return;
    const obj = store.state.stage.board.objects.find((o) => o.id === id);
    if (obj) {
      await store.dispatch("stage/deleteObject", obj);
    }
  }, objectId);
}

async function popDrawingAdmin(admin: AdminSeat, drawingId: string): Promise<void> {
  await admin.page.evaluate((id) => {
    type DevStore = { commit: (t: string, p?: unknown) => void };
    const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
    if (!store) return;
    store.commit("stage/POP_DRAWING", id);
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
    type DevStore = {
      dispatch: (t: string, p?: unknown) => Promise<unknown>;
      commit: (t: string, p?: unknown) => void;
      state: { stage: { board: { objects: Obj[]; drawings: Array<{ drawingId: string }> } } };
    };
    const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
    if (!store) throw new Error("Vuex store not exposed.");
    const objects = [...store.state.stage.board.objects];
    for (const obj of objects) {
      await store.dispatch("stage/deleteObject", obj);
    }
    for (const d of [...store.state.stage.board.drawings]) {
      store.commit("stage/POP_DRAWING", d.drawingId);
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
  test.setTimeout(5 * 60_000);

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
      `[features] seats ready: stage=${runtime.stageSlug} ` +
        `props=${Object.keys(runtime.props).join(",")}`,
    );
  });

  // Defense-in-depth: even if a per-test cleanup is skipped (e.g. an
  // assertion threw before the cleanup line), the next test starts clean.
  test.afterEach(async () => {
    try {
      await cleanBoard(admin, audience);
    } catch (err) {
      console.warn(
        `[features] afterEach cleanBoard failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  });

  test.afterAll(async () => {
    await admin?.context.close().catch(() => {});
    await audience?.context.close().catch(() => {});
  });

  // ---------------------------------------------------------------------
  // 1. Drawing — admin saves a drawing as a prop; audience sees the placed
  //    object (with `drawingId`) on their board and the rendered <canvas>.
  // ---------------------------------------------------------------------
  test("drawing saved as prop appears on audience board", async () => {
    const drawingId = uuidv4();
    const payload = buildDrawingPayload({ drawingId, type: "prop", x: 200, y: 200 });

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
    await expect(wrapper.locator("canvas").first()).toBeVisible({ timeout: 5_000 });

    await audience.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "drawing-prop.png"),
      fullPage: true,
    });

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
    const drawingId = uuidv4();
    const payload = buildDrawingPayload({ drawingId, type: "avatar", x: 400, y: 200 });

    const placedId = await addAndPublishDrawing(admin, payload);

    const objects = await pollUntil<BoardObject[]>(
      `audience board has avatar drawing ${drawingId}`,
      async () => (await audience.live.getStageState<BoardObject[]>("board.objects")) ?? [],
      (objs) => objs.some((o) => o.drawingId === drawingId),
    );
    const placed = objects.find((o) => o.drawingId === drawingId)!;
    expect(placed.type).toBe("avatar");
    expect(placed.id).toBe(placedId);

    // Admin should now hold this avatar (placeObjectOnStage avatar branch
    // calls user/setAvatarId on the dispatcher). Asserting on admin keeps
    // this test honest about the side-effect; audience won't see `holder`
    // change until the admin moves and the MQTT MOVE_TO carries it.
    const heldId = await admin.page.evaluate(() => {
      type DevStore = { state: { user: { avatarId: string | null } } };
      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      return store?.state?.user?.avatarId ?? null;
    });
    expect(heldId).toBe(placed.id);

    await audience.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "drawing-avatar.png"),
      fullPage: true,
    });

    await deleteObjectAdmin(admin, placed.id);
    await popDrawingAdmin(admin, drawingId);
  });

  // ---------------------------------------------------------------------
  // 3. Opacity — the OpacitySlider component dispatches `stage/shapeObject`
  //    with a new opacity. Verify that change reaches the audience seat
  //    in both Vuex state AND the rendered DOM (Object.vue binds opacity
  //    via :style="{ opacity: object.opacity }").
  // ---------------------------------------------------------------------
  test("opacity change on a placed prop propagates to observers", async () => {
    const propKey = Object.keys(runtime.props)[0];
    if (!propKey) test.skip(true, "runtime.json has no props — re-run pnpm e2e:setup");

    const placedId = await placeProp({
      admin,
      runtime,
      propKey,
      to: { x: 350, y: 350 },
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

    // Drive the opacity change the same way OpacitySlider.vue does:
    // shapeObject({...object, opacity: 0.3}). No `liveAction` flag here —
    // OpacitySlider's `sendChangeOpacity` doesn't set one either; the
    // shapeObject action's non-liveAction branch broadcasts an UPDATE
    // BOARD message that audience receives via handleBoardMessage.
    await admin.page.evaluate(async (id) => {
      type DevStore = {
        dispatch: (t: string, p?: unknown) => Promise<unknown>;
        state: { stage: { board: { objects: Array<{ id: string } & Record<string, unknown>> } } };
      };
      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      if (!store) throw new Error("Vuex store not exposed.");
      const obj = store.state.stage.board.objects.find((o) => o.id === id);
      if (!obj) throw new Error(`admin lost track of object ${id} before opacity dispatch`);
      await store.dispatch("stage/shapeObject", { ...obj, opacity: 0.3 });
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

    await audience.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "opacity.png"),
      fullPage: true,
    });

    await deleteObjectAdmin(admin, placedId);
  });

  // ---------------------------------------------------------------------
  // 4. Depth — admin places three props, then dispatches bringToFrontOf to
  //    move the first prop in front of the third. BRING_TO_FRONT_OF moves
  //    the `front` object to immediately precede `back` in board.objects;
  //    audience should see the same final ordering.
  // ---------------------------------------------------------------------
  test("depth (bringToFrontOf) reorders board.objects on observers", async () => {
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

    const id1 = await placeProp({ admin, runtime, propKey: k1, to: { x: 200, y: 450 } });
    const id2 = await placeProp({ admin, runtime, propKey: k2, to: { x: 300, y: 450 } });
    const id3 = await placeProp({ admin, runtime, propKey: k3, to: { x: 400, y: 450 } });

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

    // Dispatch the same action Skeleton.vue's drop handler fires.
    await admin.live.dispatchAction("stage/bringToFrontOf", { front: id1, back: id3 });

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

    await audience.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "depth.png"),
      fullPage: true,
    });

    await deleteObjectAdmin(admin, id1);
    await deleteObjectAdmin(admin, id2);
    await deleteObjectAdmin(admin, id3);
  });
});
