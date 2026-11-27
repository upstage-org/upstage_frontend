/**
 * Multiframe animation at a long speed, in REAL time (@multiframe-timing).
 *
 * GitHub #1582 "multiframe animation speed doesn't work at 300 seconds": a
 * multiframe prop set to 300 s never changed frame, while 2–30 s worked.
 * Cause: the stage store hands every object component a rebuilt object
 * whenever anything on stage changes, and the autoplay watcher in Object.vue
 * restarted its timer on each of those — a 300 s timer never got to tick.
 *
 * This test waits the full five minutes on the wall clock (no fake timers):
 *
 *   • the performer places a multiframe prop, and sets its speed to 300 the
 *     way a player does — right-click, type 300 in the speed field, Enter;
 *   • for the next five minutes the stage stays busy, which is what used to
 *     reset the timer: another prop is moved every 20 s, the animated prop
 *     itself is moved, and an extra audience member joins and later leaves;
 *   • on the performer's seat AND an audience seat the first frame must stay
 *     up for the whole 300 s and the second frame must arrive at 300 s;
 *   • latecomers see what everyone else sees (the shared start time): an
 *     audience member who arrives 100 s in must change frame at the same
 *     moment as the two seats that were there from the start, and one who
 *     arrives after the change must already be on the second frame. A
 *     latecomer's stage state comes from the event archive, so this part
 *     needs the e2e archive worker (`tests/e2e/env/e2e-archive-up.sh`) and
 *     `E2E_EVENT_ARCHIVE=1`; without them it is skipped and the late
 *     arrival only serves as stage activity.
 *
 * Each seat is timed from the moment IT received the speed, sampled inside
 * the page every 100 ms, so the measurement does not depend on test-runner
 * round trips. The sampler also counts how often the store rebuilt the
 * prop's object, to prove the stage activity really reached that seat.
 *
 * Takes about five and a half minutes. Run it on its own:
 *   tests/e2e/env/e2e-archive-up.sh
 *   E2E_EVENT_ARCHIVE=1 pnpm exec tsx ./tests/e2e/run-e2e.ts test --project=multiframe-timing
 *   docker rm -f upstage_event_archive_e2e
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { ADMIN } from "./personas";
import { LoginPage } from "./pages/LoginPage";
import { LiveStagePage } from "./pages/LiveStagePage";
import { readRuntime, type RuntimeState } from "./fixtures/runtime";

const SPEED_SECONDS = 300;
const SPEED_MS = SPEED_SECONDS * 1000;
/** The frame may not change earlier than this before the mark… */
const EARLY_TOLERANCE_MS = 250;
/** …and must be on screen this soon after it (timer jitter + image decode). */
const LATE_TOLERANCE_MS = 3_000;
const SAMPLE_MS = 100;
/**
 * How far apart a latecomer's frame change may be from the seats that were
 * there from the start. The latecomer places the start from the archive's
 * server timestamp and its own measured clock offset (utils/serverClock.ts).
 */
const LATECOMER_TOLERANCE_MS = 1_500;
const ARCHIVE = process.env.E2E_EVENT_ARCHIVE === "1";

interface Seat {
  name: string;
  context: BrowserContext;
  page: Page;
  live: LiveStagePage;
}

interface TimingReport {
  /** Speed seen on this seat's copy of the object (must be 300). */
  speed: number | null;
  /** ms from this seat receiving the speed to frame 2 being displayed. */
  firstChangeAfterMs: number | null;
  /** Wall-clock time (`Date.now()`) frame 2 was first displayed. */
  firstChangeAtWall: number | null;
  /** Frame index displayed at the first sample. */
  firstShown: number | null;
  /** ms the first frame was continuously displayed after the speed arrived. */
  firstFrameHeldMs: number;
  /** Displayed frame indexes in order of appearance, e.g. [0, 1]. */
  sequence: number[];
  /** Times the store handed out a rebuilt object for the prop while waiting. */
  objectRebuilds: number;
  samples: number;
  /** Longest gap between two samples: a large value means throttled timers. */
  maxSampleGapMs: number;
}

declare global {
  interface Window {
    __mfTiming?: {
      report: () => TimingReport;
      stop: () => void;
    };
  }
}

async function openAudience(browser: Browser, runtime: RuntimeState, name: string): Promise<Seat> {
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
  return { name, context, page, live };
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
  return { name: "performer", context, page, live };
}

async function cleanBoard(admin: Seat): Promise<void> {
  await admin.page.evaluate(async () => {
    const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
      board: { objects: Array<{ id: string }> };
      deleteObject: (p: unknown) => unknown;
    };
    for (const o of [...stage.board.objects]) await Promise.resolve(stage.deleteObject(o));
  });
}

/**
 * Place two published props from the performer's seat: a two-frame
 * multiframe prop (the e2e media library has only single images, so its
 * frames are the two prop images) and a plain one to move around.
 */
async function placeProps(admin: Seat, runtime: RuntimeState) {
  const refs = Object.values(runtime.props);
  if (refs.length < 2) {
    throw new Error("[multiframe-timing] runtime.json needs two props — re-run pnpm e2e:setup");
  }
  return admin.page.evaluate(
    async ({ names }) => {
      type ToolboxProp = { id: string | number; name?: string; src?: string };
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        tools: { props: ToolboxProp[] };
        board: { objects: Array<{ id: string }> };
        placeObjectOnStage: (p: unknown) => { id: string };
        shapeObject: (p: unknown) => unknown;
      };
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
      let found: ToolboxProp[] = [];
      for (let i = 0; i < 40; i += 1) {
        found = names
          .map((n) => (stage.tools.props ?? []).find((p) => p.name === n))
          .filter((p): p is ToolboxProp => Boolean(p?.src));
        if (found.length === names.length) break;
        await sleep(250);
      }
      if (found.length !== names.length) throw new Error("props not in toolbox");
      const frames = found.map((p) => p.src as string);
      const publish = (data: Record<string, unknown>) => {
        const placed = stage.placeObjectOnStage(data);
        const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
        if (!fromBoard) throw new Error("placeObjectOnStage did not push into board.objects");
        stage.shapeObject({ ...fromBoard, liveAction: true, published: false });
        return placed.id;
      };
      const size = { w: 160, h: 160 };
      const animatedId = publish({
        ...found[0],
        name: "mf-timing-animated",
        multi: true,
        frames,
        x: 200,
        y: 250,
        ...size,
      });
      const otherId = publish({ ...found[1], name: "mf-timing-other", x: 600, y: 250, ...size });
      return { animatedId, otherId, frames };
    },
    { names: refs.slice(0, 2).map((r) => r.name) },
  );
}

/**
 * Start the in-page sampler. It begins timing when this seat's copy of the
 * object first carries the speed, then records what the prop's <img> shows.
 */
async function startSampler(seat: Seat, objectId: string, frames: string[], speed: number) {
  await seat.page.evaluate(
    ({ objectId, frames, speed, sampleMs }) => {
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        objects: Array<{ id: string; autoplayFrames?: number | string | null }>;
      };
      let startedAt: number | null = null;
      let seenSpeed: number | null = null;
      let firstChangeAfterMs: number | null = null;
      let firstChangeAtWall: number | null = null;
      let firstShown: number | null = null;
      let firstFrameHeldMs = 0;
      let rebuilds = 0;
      let samples = 0;
      let maxGap = 0;
      let lastSampleAt: number | null = null;
      let lastObject: unknown = null;
      const sequence: number[] = [];

      const shownFrames = () =>
        [...document.querySelectorAll(`[data-object-id="${objectId}"] img`)]
          .map((img) => frames.indexOf(img.getAttribute("src") ?? ""))
          .filter((i) => i >= 0);

      const sample = () => {
        const now = performance.now();
        const object = stage.objects.find((o) => o.id === objectId);
        if (startedAt == null) {
          if (object && Number(object.autoplayFrames) === speed) {
            startedAt = now;
            seenSpeed = Number(object.autoplayFrames);
            lastObject = object;
          } else {
            return;
          }
        }
        samples += 1;
        if (lastSampleAt != null) maxGap = Math.max(maxGap, now - lastSampleAt);
        lastSampleAt = now;
        if (object !== lastObject) {
          rebuilds += 1;
          lastObject = object;
        }
        const shown = shownFrames();
        if (firstShown == null && shown.length) firstShown = shown[shown.length - 1];
        for (const frame of shown) {
          if (sequence[sequence.length - 1] !== frame && !sequence.includes(frame)) {
            sequence.push(frame);
          }
        }
        if (firstChangeAfterMs == null) {
          if (shown.includes(1)) {
            firstChangeAfterMs = now - startedAt;
            firstChangeAtWall = Date.now();
          } else if (shown.length === 1 && shown[0] === 0) firstFrameHeldMs = now - startedAt;
        }
      };
      const timer = setInterval(sample, sampleMs);
      window.__mfTiming = {
        report: () => ({
          speed: seenSpeed,
          firstChangeAfterMs,
          firstChangeAtWall,
          firstShown,
          firstFrameHeldMs,
          sequence,
          objectRebuilds: rebuilds,
          samples,
          maxSampleGapMs: Math.round(maxGap),
        }),
        stop: () => clearInterval(timer),
      };
    },
    { objectId, frames, speed, sampleMs: SAMPLE_MS },
  );
}

const report = (seat: Seat) => seat.page.evaluate(() => window.__mfTiming!.report());

/** Move an object from the performer's seat with a real published update. */
async function moveObject(admin: Seat, id: string, to: { x: number; y: number }) {
  await admin.page.evaluate(
    ({ id, to }) => {
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        board: { objects: Array<{ id: string }> };
        shapeObject: (p: unknown) => unknown;
      };
      const object = stage.board.objects.find((o) => o.id === id);
      if (!object) throw new Error(`moveObject: ${id} not on the board`);
      stage.shapeObject({ ...object, ...to });
    },
    { id, to },
  );
}

test.describe("multiframe animation at 300 seconds @multiframe-timing", () => {
  let runtime: RuntimeState;
  let admin: Seat;
  let audience: Seat;

  test.beforeAll(async ({ browser }) => {
    runtime = readRuntime();
    admin = await openAdmin(browser, runtime);
    audience = await openAudience(browser, runtime, "audience");
    await cleanBoard(admin);
  });

  test.afterAll(async () => {
    await admin?.page.evaluate(() => window.__mfTiming?.stop()).catch(() => {});
    await audience?.page.evaluate(() => window.__mfTiming?.stop()).catch(() => {});
    if (admin) await cleanBoard(admin).catch(() => {});
    await audience?.context.close().catch(() => {});
    await admin?.context.close().catch(() => {});
  });

  test("a prop set to 300 s changes frame after five real minutes on a busy stage", async ({
    browser,
  }) => {
    test.setTimeout(SPEED_MS + 180_000);

    const { animatedId, otherId, frames } = await placeProps(admin, runtime);
    expect(frames[0]).not.toBe(frames[1]);

    // Both seats show the prop on its first frame before anything is timed.
    for (const seat of [admin, audience]) {
      await expect(
        seat.page.locator(`[data-object-id="${animatedId}"] img[src="${frames[0]}"]`),
        `${seat.name} shows the first frame`,
      ).toBeVisible({ timeout: 15_000 });
      await startSampler(seat, animatedId, frames, SPEED_SECONDS);
    }

    // Set the speed like a player: right-click → type in the speed field → Enter.
    await admin.page.bringToFront();
    const wrapper = admin.page.locator(`[data-object-id="${animatedId}"]`).first();
    await expect
      .poll(async () => Math.round((await wrapper.boundingBox())?.y ?? -9999), {
        timeout: 10_000,
        intervals: [100, 200, 500],
      })
      .toBeGreaterThan(0);
    await wrapper.click({ button: "right", force: true });
    const speedField = admin.page.locator(".avatar-context-menu .anmation-input");
    await expect(speedField).toBeVisible({ timeout: 5_000 });
    await speedField.fill(String(SPEED_SECONDS));
    await speedField.press("Enter");

    for (const seat of [admin, audience]) {
      await expect
        .poll(async () => (await report(seat)).speed, {
          message: `${seat.name} received the 300 s speed`,
          timeout: 10_000,
        })
        .toBe(SPEED_SECONDS);
    }
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;
    const waitUntil = async (ms: number) => {
      const remaining = ms - elapsed();
      if (remaining > 0) await admin.page.waitForTimeout(remaining);
    };

    // Five minutes of ordinary stage activity.
    let late: Seat | null = null;
    for (let t = 20_000; t <= 280_000; t += 20_000) {
      await waitUntil(t);
      if (t === 60_000 || t === 220_000) {
        // The animated prop itself is moved.
        await moveObject(admin, animatedId, { x: t === 60_000 ? 260 : 200, y: 250 });
      } else if (t === 100_000) {
        // Someone arrives a third of the way through.
        late = await openAudience(browser, runtime, "late audience");
        if (ARCHIVE) {
          await expect(
            late.page.locator(`[data-object-id="${animatedId}"] img[src="${frames[0]}"]`),
            "late audience shows the first frame on arrival",
          ).toBeVisible({ timeout: 15_000 });
          await startSampler(late, animatedId, frames, SPEED_SECONDS);
        }
      } else {
        await moveObject(admin, otherId, { x: 600 + ((t / 20_000) % 2) * 80, y: 250 });
      }
      // Still on the first frame everywhere, all the way through.
      for (const seat of [admin, audience]) {
        const r = await report(seat);
        expect(r.sequence, `${seat.name} at ${t / 1000}s`).toEqual([0]);
      }
    }

    // Just short of the mark: nothing has changed yet.
    await waitUntil(SPEED_MS - 5_000);
    for (const seat of [admin, audience]) {
      const r = await report(seat);
      expect(r.firstChangeAfterMs, `${seat.name} has not changed before 295 s`).toBeNull();
    }

    await waitUntil(SPEED_MS + LATE_TOLERANCE_MS + 2_000);
    const changedAt: number[] = [];
    for (const seat of [admin, audience]) {
      const r = await report(seat);
      changedAt.push(r.firstChangeAtWall ?? NaN);
      console.log(`[multiframe-timing] ${seat.name}: ${JSON.stringify(r)}`);
      // The stage activity really did rebuild this prop's object here.
      expect(r.objectRebuilds, `${seat.name}: store rebuilt the object`).toBeGreaterThanOrEqual(10);
      // Timers ran freely (a throttled background tab would invalidate timing).
      expect(r.maxSampleGapMs, `${seat.name}: sampler was not throttled`).toBeLessThan(1_500);
      // First frame stayed up for the full five minutes…
      expect(r.firstFrameHeldMs, `${seat.name}: first frame held`).toBeGreaterThanOrEqual(
        SPEED_MS - EARLY_TOLERANCE_MS - SAMPLE_MS,
      );
      // …and the second arrived at the 300 s mark.
      expect(r.firstChangeAfterMs, `${seat.name}: frame changed`).not.toBeNull();
      expect(r.firstChangeAfterMs!).toBeGreaterThanOrEqual(SPEED_MS - EARLY_TOLERANCE_MS);
      expect(r.firstChangeAfterMs!).toBeLessThanOrEqual(SPEED_MS + LATE_TOLERANCE_MS);
      expect(r.sequence).toEqual([0, 1]);
    }

    if (!ARCHIVE) {
      console.log(
        "[multiframe-timing] latecomer checks skipped: they need the e2e archive worker and E2E_EVENT_ARCHIVE=1",
      );
      await late?.context.close().catch(() => {});
      return;
    }
    try {
      // The seat that arrived 100 s in changed frame with everyone else —
      // about 200 s after it arrived, not 300.
      const r = await report(late!);
      console.log(`[multiframe-timing] late audience: ${JSON.stringify(r)}`);
      expect(r.firstShown, "late audience arrived on the first frame").toBe(0);
      expect(r.sequence).toEqual([0, 1]);
      expect(r.maxSampleGapMs, "late audience: sampler was not throttled").toBeLessThan(1_500);
      expect(r.firstChangeAtWall, "late audience: frame changed").not.toBeNull();
      for (const other of changedAt) {
        expect(
          Math.abs(r.firstChangeAtWall! - other),
          "late audience changed frame together with the seats there from the start",
        ).toBeLessThanOrEqual(LATECOMER_TOLERANCE_MS);
      }
      expect(r.firstChangeAfterMs!).toBeLessThan(SPEED_MS - 60_000);

      // Someone who arrives after the change is on the second frame at once
      // and stays there (the next change is five minutes away).
      const veryLate = await openAudience(browser, runtime, "very late audience");
      try {
        await expect(
          veryLate.page.locator(`[data-object-id="${animatedId}"] img[src="${frames[1]}"]`),
          "very late audience arrives on the second frame",
        ).toBeVisible({ timeout: 15_000 });
        await startSampler(veryLate, animatedId, frames, SPEED_SECONDS);
        await veryLate.page.waitForTimeout(5_000);
        const v = await report(veryLate);
        console.log(`[multiframe-timing] very late audience: ${JSON.stringify(v)}`);
        expect(v.firstShown).toBe(1);
        expect(v.sequence).toEqual([1]);
      } finally {
        await veryLate.context.close().catch(() => {});
      }
    } finally {
      await late?.context.close().catch(() => {});
    }
  });
});
