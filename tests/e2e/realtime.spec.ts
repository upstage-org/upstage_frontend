/**
 * Real-time stage sync (@realtime).
 *
 *  1. Live drag — while the admin holds the mouse down and moves a prop,
 *     the audience's board already tracks intermediate positions
 *     (Moveable.vue publishes throttled `live` MOVE_TOs); the admin's own
 *     seat shows no ghost copy / half-opacity preview during the move; and
 *     after release everyone converges on the drop position.
 *
 *  2. Backdrop change / clear — SET_BACKGROUND fades ONLY the backdrop
 *     layer (`#stage-backdrop`). `#board`, which holds every object on the
 *     stage, must stay at full opacity the whole time (it used to be the
 *     fade target, blanking all objects for a 5s fade-in).
 *
 * Same seat pattern as features.spec.ts: admin performer + anonymous
 * audience, driven through the `window.__UPSTAGE_PINIA__` dev hook.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { ADMIN } from "./personas";
import { LoginPage } from "./pages/LoginPage";
import { LiveStagePage } from "./pages/LiveStagePage";
import { readRuntime, type RuntimeState } from "./fixtures/runtime";

interface BoardObject {
  id: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  [k: string]: unknown;
}

interface Seat {
  context: BrowserContext;
  page: Page;
  live: LiveStagePage;
}

const POLL_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 150;

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
  throw new Error(`[realtime] timed out waiting for: ${label}\nlast=${JSON.stringify(last)}`);
}

async function openAudience(browser: Browser, runtime: RuntimeState): Promise<Seat> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const live = new LiveStagePage(page);
  await live.goto(runtime.stageSlug);
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
    timeout: 30_000,
  });
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

async function openAdmin(browser: Browser, runtime: RuntimeState): Promise<Seat> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await new LoginPage(page).login(ADMIN.username, ADMIN.password);
  const live = new LiveStagePage(page);
  await live.goto(runtime.stageSlug);
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
    timeout: 30_000,
  });
  return { context, page, live };
}

const objects = async (seat: Seat) =>
  (await seat.live.getStageState<BoardObject[]>("board.objects")) ?? [];

/** Place + publish a prop from the admin seat (mirrors features.spec placeProp). */
async function placeProp(
  admin: Seat,
  runtime: RuntimeState,
  to: { x: number; y: number },
  size: { w: number; h: number },
): Promise<string> {
  const key = Object.keys(runtime.props)[0];
  const ref = runtime.props[key];
  if (!ref) throw new Error("[realtime] runtime.json has no props — re-run pnpm e2e:setup");
  return admin.page.evaluate(
    async ({ mediaId, mediaName, to, size }) => {
      type ToolboxProp = { id: string | number; name?: string };
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        tools: { props: ToolboxProp[] };
        board: { objects: Array<{ id: string }> };
        placeObjectOnStage: (p: unknown) => { id: string };
        shapeObject: (p: unknown) => unknown;
      };
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      let prop: ToolboxProp | undefined;
      for (let i = 0; i < 40; i += 1) {
        const candidates = stage.tools.props ?? [];
        prop =
          candidates.find((p) => p.name === mediaName) ??
          candidates.find((p) => String(p.id) === String(mediaId));
        if (prop) break;
        await sleep(250);
      }
      if (!prop) throw new Error(`prop ${mediaName} not in toolbox`);
      const placed = stage.placeObjectOnStage({
        ...prop,
        name: mediaName,
        x: to.x,
        y: to.y,
        ...size,
      });
      const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
      if (!fromBoard) throw new Error("placeObjectOnStage did not push into board.objects");
      stage.shapeObject({ ...fromBoard, liveAction: true, published: false });
      return placed.id;
    },
    { mediaId: ref.id, mediaName: ref.name, to, size },
  );
}

async function cleanBoard(admin: Seat, audience: Seat): Promise<void> {
  const ids = await admin.page.evaluate(async () => {
    const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
      board: { objects: Array<{ id: string }> };
      deleteObject: (p: unknown) => unknown;
    };
    const objs = [...stage.board.objects];
    for (const o of objs) await Promise.resolve(stage.deleteObject(o));
    return objs.map((o) => o.id);
  });
  if (!ids.length) return;
  await pollUntil(
    "audience board cleared",
    () => objects(audience),
    (objs) => ids.every((id) => !objs.some((o) => o.id === id)),
  );
}

/**
 * Sample computed opacity of #board and #stage-backdrop every `stepMs` for
 * `durationMs`, in-page (so sampling is not throttled by the CDP round
 * trip). Returns the raw series for both.
 */
function startOpacitySampler(page: Page, durationMs: number, stepMs = 50) {
  return page.evaluate(
    ({ durationMs, stepMs }) =>
      new Promise<{ board: number[]; backdrop: number[] }>((resolve) => {
        const board = document.querySelector("#board") as HTMLElement | null;
        const backdrop = document.querySelector("#stage-backdrop") as HTMLElement | null;
        const out = { board: [] as number[], backdrop: [] as number[] };
        const started = performance.now();
        const tick = () => {
          out.board.push(board ? Number(getComputedStyle(board).opacity) : NaN);
          out.backdrop.push(backdrop ? Number(getComputedStyle(backdrop).opacity) : NaN);
          if (performance.now() - started < durationMs) setTimeout(tick, stepMs);
          else resolve(out);
        };
        tick();
      }),
    { durationMs, stepMs },
  );
}

test.describe("real-time stage sync @realtime", () => {
  let runtime: RuntimeState;
  let admin: Seat;
  let audience: Seat;

  test.beforeAll(async ({ browser }) => {
    runtime = readRuntime();
    admin = await openAdmin(browser, runtime);
    audience = await openAudience(browser, runtime);
    await cleanBoard(admin, audience);
  });

  test.afterEach(async () => {
    await cleanBoard(admin, audience).catch(() => {});
  });

  test.afterAll(async () => {
    // Leave the stage without a backdrop for whoever runs next.
    await admin?.page
      .evaluate(() => {
        (
          window.__UPSTAGE_PINIA__!.stage as unknown as { setBackground: (b: unknown) => void }
        ).setBackground({ src: null });
      })
      .catch(() => {});
    await admin?.context.close().catch(() => {});
    await audience?.context.close().catch(() => {});
  });

  test("audience sees a dragged prop move before the mouse is released", async () => {
    const size = { w: 160, h: 160 };
    const start = { x: 200, y: 260 };
    const placedId = await placeProp(admin, runtime, start, size);

    await pollUntil(
      `audience has prop ${placedId}`,
      () => objects(audience),
      (objs) => objs.some((o) => o.id === placedId),
    );
    const audienceStart = (await objects(audience)).find((o) => o.id === placedId)!;
    expect(audienceStart.x).toBeCloseTo(start.x, 0);

    // Real pointer drag on the admin seat, held down for ~1.5s while the
    // audience store is polled in parallel.
    const wrapper = admin.page.locator(`[data-object-id="${placedId}"]`).first();
    await wrapper.waitFor({ state: "attached", timeout: 10_000 });
    // Placement runs an enter animation (Board.vue avatarEnter: scale 0→1,
    // translateY -200→0): an immediate boundingBox() is mid-animation
    // geometry and the click lands on empty board. Wait for it to settle,
    // then gate on the browser's own hit-test (same as features test 8).
    let prevBox = "";
    const settled = await pollUntil(
      "prop bounding box settles after the enter animation",
      async () => {
        const b = await wrapper.boundingBox();
        const cur = b ? [b.x, b.y, b.width, b.height].map((n) => Math.round(n)).join(",") : "none";
        const stable = b != null && cur === prevBox;
        prevBox = cur;
        return stable ? { box: b! } : { settling: cur };
      },
      (v) => "box" in v,
    );
    const box = ("box" in settled ? settled.box : null)!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const delta = { x: 420, y: 90 };
    await pollUntil(
      "prop wins the hit-test at its centre",
      () =>
        admin.page.evaluate(
          ({ x, y }) =>
            document
              .elementFromPoint(x, y)
              ?.closest?.("[data-object-id]")
              ?.getAttribute("data-object-id") ?? "MISS",
          from,
        ),
      (v) => v === placedId,
    );
    // Select first (green frame), exactly like a performer does, then drag.
    await admin.page.mouse.click(from.x, from.y);
    await pollUntil(
      "prop selected",
      () => admin.live.getStageState<string | null>("activeMovable"),
      (v) => v === placedId,
    );

    await admin.page.mouse.move(from.x, from.y);
    await admin.page.mouse.down();

    const samples: number[] = [];
    let dragging = true;
    const sampler = (async () => {
      while (dragging) {
        const o = (await objects(audience)).find((x) => x.id === placedId);
        if (o?.x != null) samples.push(Number(o.x));
        await new Promise((r) => setTimeout(r, 60));
      }
    })();

    const steps = 30;
    let ghostCount = -1;
    let wrapperOpacityMidDrag = "";
    for (let i = 1; i <= steps; i += 1) {
      await admin.page.mouse.move(from.x + (delta.x * i) / steps, from.y + (delta.y * i) / steps);
      await admin.page.waitForTimeout(50);
      if (i === Math.floor(steps / 2)) {
        // Sender side, mid-drag: exactly one rendered copy (no ghost) at
        // full opacity — the element under the pointer IS the live object.
        ghostCount = await admin.page.locator(`[data-object-id="${placedId}"]`).count();
        wrapperOpacityMidDrag = await wrapper.evaluate(
          (el) => getComputedStyle((el as HTMLElement).parentElement!).opacity,
        );
      }
    }
    // Snapshot BEFORE releasing: what the audience saw during the hold.
    const seenWhileHeld = [...samples];
    await admin.page.mouse.up();
    dragging = false;
    await sampler;

    expect(ghostCount).toBe(1);
    expect(wrapperOpacityMidDrag).toBe("1");

    const distinct = [...new Set(seenWhileHeld.map((x) => Math.round(x)))];
    const movedWhileHeld = distinct.filter((x) => Math.abs(x - start.x) > 5);
    console.log(
      `[realtime] audience x while mouse held: ${distinct.join(" → ")} (start ${start.x})`,
    );
    // Several intermediate positions, not just the start (old behaviour:
    // nothing moved until mouse-up), and none of them is the final drop.
    expect(movedWhileHeld.length).toBeGreaterThanOrEqual(3);
    const finalX = start.x + delta.x;
    expect(movedWhileHeld.some((x) => x < finalX - 20)).toBe(true);

    // Everyone converges on the drop position.
    await pollUntil(
      `audience settles at x≈${finalX}`,
      () => objects(audience),
      (objs) => {
        const o = objs.find((x) => x.id === placedId);
        return Boolean(o && Math.abs(Number(o.x) - finalX) < 4);
      },
    );
    const adminFinal = (await objects(admin)).find((o) => o.id === placedId)!;
    expect(Math.abs(Number(adminFinal.x) - finalX)).toBeLessThan(4);
  });

  test("changing and clearing the backdrop never dims the objects on the board", async () => {
    const placedId = await placeProp(admin, runtime, { x: 300, y: 200 }, { w: 200, h: 200 });
    await pollUntil(
      `audience has prop ${placedId}`,
      () => objects(audience),
      (objs) => objs.some((o) => o.id === placedId),
    );

    const backdropKey = Object.keys(runtime.backdrops)[0];
    const backdropRef = runtime.backdrops[backdropKey];
    if (!backdropRef) test.skip(true, "runtime.json has no backdrops — re-run pnpm e2e:setup");

    const applyBackdrop = (src: "asset" | "clear") =>
      admin.page.evaluate(
        async ({ mediaId, mediaName, src }) => {
          type Backdrop = { id: string | number; name?: string; src?: string | null };
          const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
            tools: { backdrops: Backdrop[] };
            setBackground: (b: unknown) => void;
          };
          if (src === "clear") {
            stage.setBackground({ src: null });
            return;
          }
          const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
          let backdrop: Backdrop | undefined;
          for (let i = 0; i < 40; i += 1) {
            const list = stage.tools.backdrops ?? [];
            backdrop =
              list.find((b) => b.name === mediaName) ??
              list.find((b) => String(b.id) === String(mediaId));
            if (backdrop) break;
            await sleep(250);
          }
          if (!backdrop) throw new Error(`backdrop ${mediaName} not in toolbox`);
          stage.setBackground({ ...backdrop });
        },
        { mediaId: backdropRef.id, mediaName: backdropRef.name, src },
      );

    for (const step of ["asset", "clear"] as const) {
      const sampleAudience = startOpacitySampler(audience.page, 1500);
      const sampleAdmin = startOpacitySampler(admin.page, 1500);
      await audience.page.waitForTimeout(100);
      await applyBackdrop(step);
      const [aud, adm] = await Promise.all([sampleAudience, sampleAdmin]);

      for (const [seat, series] of [
        ["audience", aud],
        ["admin", adm],
      ] as const) {
        console.log(
          `[realtime] ${step}/${seat}: board min ${Math.min(...series.board)}, ` +
            `backdrop min ${Math.min(...series.backdrop).toFixed(2)} over ${series.board.length} samples`,
        );
        // Objects untouched: the board never dims, at all.
        expect(series.board.every((v) => v === 1)).toBe(true);
        // The fade itself still runs — on the backdrop layer only.
        expect(Math.min(...series.backdrop)).toBeLessThan(0.6);
      }

      if (step === "asset") {
        await pollUntil(
          "audience shows the backdrop image",
          () => audience.page.locator("#stage-backdrop img").count(),
          (n) => n >= 1,
        );
      } else {
        await pollUntil(
          "audience backdrop image removed",
          () => audience.page.locator("#stage-backdrop img").count(),
          (n) => n === 0,
        );
      }
      // Let the 5s fade finish before the next step so the two runs don't
      // overlap in the sampler.
      await audience.page.waitForTimeout(5_200);
    }

    // The prop is still there, and still fully opaque, on both seats.
    for (const seat of [admin, audience]) {
      const opacity = await seat.page
        .locator(`[data-object-id="${placedId}"]`)
        .first()
        .evaluate((el) => getComputedStyle((el as HTMLElement).parentElement!).opacity);
      expect(opacity).toBe("1");
    }
  });
});
