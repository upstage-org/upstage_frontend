import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

import { ADMIN, PERSONAS, type AvatarVoice, type Persona } from "./personas";
import { LoginPage } from "./pages/LoginPage";
import { LiveStagePage } from "./pages/LiveStagePage";
import { BEATS, SMOKE_BEATS, type Beat } from "./script/romeo-and-juliet-a1s1";
import { readRuntime, type RuntimeState } from "./fixtures/runtime";
import { loadE2eConfig } from "./e2e-config";
import { gql } from "./graphql";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, "..", "..", "test-results", "perform");

interface CastSeat {
  persona: Persona;
  context: BrowserContext;
  page: Page;
  live: LiveStagePage;
}

interface AudienceSeat {
  context: BrowserContext;
  page: Page;
  live: LiveStagePage;
}

type PaceKind = "fast" | "normal" | "slow";

/**
 * Decide how long to wait between beats. When a human is watching the play
 * (headed Chromium) we deliberately slow down so each line's TTS finishes,
 * each move can be tracked by eye, and backdrop changes don't whip past.
 * Headless / CI runs default to "fast" (zero pause) to keep the suite quick.
 *
 * Override with `E2E_PACE=fast|normal|slow`.
 */
function resolvePace(): PaceKind {
  const explicit = process.env.E2E_PACE?.trim().toLowerCase();
  if (explicit === "fast" || explicit === "normal" || explicit === "slow") {
    return explicit;
  }
  return loadE2eConfig().headless ? "fast" : "slow";
}

/**
 * Per-beat pause in milliseconds, after the beat's primary action has been
 * dispatched/asserted. The "speak" family scales with the line length so
 * meSpeak gets time to finish (rough rate of ~70ms/char + an 800ms tail).
 */
function pauseAfterBeatMs(beat: Beat, pace: PaceKind): number {
  if (pace === "fast") return 0;
  const mult = pace === "normal" ? 0.5 : 1;
  switch (beat.kind) {
    case "speak":
    case "shout":
    case "think":
      return Math.round((800 + 70 * (beat.line?.length ?? 0)) * mult);
    case "move":
      return Math.round(1200 * mult);
    case "enter":
      return Math.round(600 * mult);
    case "exit":
      return Math.round(400 * mult);
    case "backdrop":
      return Math.round(1500 * mult);
    default:
      return 0;
  }
}

/**
 * Should pass 3 (audience replay of the recorded live performance) run?
 * Default: yes when headed (a human is watching and wants the replay), no
 * when headless (CI shouldn't pay an extra ~live-performance-length wall
 * clock just to re-watch the same events). Override with E2E_REPLAY=1|0.
 *
 * Only consulted as the *default* for the replay phase when E2E_PHASES is
 * unset; once E2E_PHASES is set explicitly, this is ignored.
 */
function shouldRunReplay(): boolean {
  const explicit = process.env.E2E_REPLAY?.trim().toLowerCase();
  if (explicit === "1" || explicit === "true") return true;
  if (explicit === "0" || explicit === "false") return false;
  return !loadE2eConfig().headless;
}

type Phase = "rehearsal" | "live" | "replay";
const ALL_PHASES: readonly Phase[] = ["rehearsal", "live", "replay"];

/**
 * Comma-separated subset of `rehearsal,live,replay`. When unset, defaults
 * to `rehearsal + live` always, plus `replay` per `shouldRunReplay()`
 * (i.e. on for headed, off for headless).
 *
 *   E2E_PHASES=rehearsal             → just pass 1 (cast + admin)
 *   E2E_PHASES=live                  → just pass 2 (cast + audience)
 *   E2E_PHASES=replay                → just pass 3 against the most
 *                                       recent existing Performance row
 *                                       (admin + audience only — no cast)
 *   E2E_PHASES=rehearsal,live        → skip replay
 *   E2E_PHASES=live,replay           → skip rehearsal (saves several min)
 *   E2E_PHASES=rehearsal,live,replay → all three (== full default headed)
 */
function parsePhases(): Set<Phase> {
  const explicit = process.env.E2E_PHASES?.trim();
  if (explicit) {
    const parts = explicit
      .toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const set = new Set<Phase>();
    for (const p of parts) {
      if ((ALL_PHASES as readonly string[]).includes(p)) {
        set.add(p as Phase);
      } else {
        throw new Error(
          `E2E_PHASES: unknown phase "${p}" — valid values are: ${ALL_PHASES.join(", ")}`,
        );
      }
    }
    if (set.size === 0) {
      throw new Error("E2E_PHASES is set but parsed to no phases.");
    }
    return set;
  }
  const phases = new Set<Phase>(["rehearsal", "live"]);
  if (shouldRunReplay()) phases.add("replay");
  return phases;
}

/**
 * The event_archive_dev worker drains MQTT into Postgres asynchronously
 * (queue + per-event INSERT). After pass 2's last beat the in-flight tail
 * may not be on disk yet; sweepStage would then bundle a truncated set of
 * events into the Performance row and the replay would be missing the last
 * line or two. This buffer is short and only paid in headed runs.
 */
function eventArchiveSettleWaitMs(pace: PaceKind): number {
  if (pace === "fast") return 1500;
  if (pace === "normal") return 2500;
  return 4000;
}

test.describe("perform: re-enact Romeo & Juliet A1S1", () => {
  test.describe.configure({ mode: "serial" });
  // Three-phase test: rehearsal, live-with-audience, then optional audience
  // replay. At pace=slow with full BEATS each phase can run several minutes;
  // 60min keeps headroom even when E2E_REPLAY=1 doubles the active wall clock.
  test.setTimeout(60 * 60_000);

  test("rehearsal + live-w-audience + audience replay @full", async ({ browser }) => {
    const runtime = readRuntime();
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const pace = resolvePace();
    const phases = parsePhases();
    const needsCast = phases.has("rehearsal") || phases.has("live");
    const needsAudience = phases.has("live") || phases.has("replay");
    console.log(
      `[perform] phases=${[...phases].join(",")} pace=${pace} ` +
        `headless=${loadE2eConfig().headless} cast=${needsCast} audience=${needsAudience}`,
    );

    const beats = process.env.E2E_BEATS === "smoke" ? SMOKE_BEATS : BEATS;
    expect(beats.length).toBeGreaterThan(0);

    // ---------- 0. Spin up admin browser FIRST --------------------------
    // The backend deletes prior UserSessionModel rows on each login (single-
    // session-per-user policy). If we did `loginAsAdmin()` from Node first,
    // then ran `adminLogin.login()` in the browser, the Node-side token
    // would be invalidated mid-test — fine for the first batch of GraphQL
    // calls below, but we'd hit "Authenticated Failed" on the cross-phase
    // mutations 3+ minutes later. Logging in the browser FIRST and pulling
    // its token from localStorage means there's only ever one live admin
    // session, and we keep using it throughout the suite.
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    const adminLoginPage = new LoginPage(adminPage);
    await adminLoginPage.login(ADMIN.username, ADMIN.password);
    const adminLive = new LiveStagePage(adminPage);
    await adminLive.goto(runtime.stageSlug);

    const getAdminToken = async (): Promise<string> => {
      const t = await adminLoginPage.getAuthToken();
      if (!t) {
        throw new Error("[perform] admin browser has no JWT in localStorage — login regression?");
      }
      return t;
    };

    // Sweep up any stray events from prior runs before we record anything
    // new (otherwise pass 2's eventual `sweepStageReturningId` would bundle
    // them into our new Performance row).
    let adminToken = await getAdminToken();
    await sweepStageIfNeeded(runtime.stageId, adminToken);

    // The only path that flips status away from "live" is rehearsal, so
    // this is the only phase that requires the finally-block restore. live
    // and replay both leave status as-is. Set true the moment we change it.
    let needsStatusRestore = false;

    // Track the in-flight references for clean teardown. seats may be empty
    // (replay-only mode), audience may be null (rehearsal-only mode).
    const seats: CastSeat[] = [];
    const seatByUsername = new Map<string, CastSeat>();
    let audience: AudienceSeat | null = null;

    try {
      // ---------- 1. Cast logins (only if a phase needs them) ---------
      if (needsCast) {
        // Flip the stage to "rehearsal" BEFORE the cast logs in if pass 1
        // will run. Each cast SPA caches `state.stage.model.status` on
        // stage load and there's no MQTT/poll path that pushes a later
        // status change to existing clients. Setting it after login
        // makes the headed run look identical to a live performance:
        // ConnectionStatus.vue keeps showing the red LIVE badge instead
        // of the blue REHEARSAL one. The teardown's needsStatusRestore
        // path will pin status back to "live" on exit.
        if (phases.has("rehearsal")) {
          await setStageStatus(runtime.stageId, "rehearsal", adminToken);
          needsStatusRestore = true;
        }
        console.log(`[perform] logging in ${PERSONAS.length} cast members…`);
        for (const persona of PERSONAS) {
          const ctx = await browser.newContext();
          const page = await ctx.newPage();
          const lp = new LoginPage(page);
          await lp.login(persona.username, persona.password);
          const live = new LiveStagePage(page);
          await live.goto(runtime.stageSlug);
          const seat: CastSeat = { persona, context: ctx, page, live };
          seats.push(seat);
          seatByUsername.set(persona.username, seat);
        }
      }

      // ---------- 2. PASS 1 — rehearsal walkthrough ------------------
      if (phases.has("rehearsal")) {
        // Status was already flipped to "rehearsal" in the pre-login
        // block above so the cast SPAs picked it up at load time.
        console.log("[perform] PASS 1: rehearsal mode (cast + admin observer)");
        await runPass({
          label: "rehearsal",
          beats,
          adminLive,
          viewerLive: adminLive,
          seatByUsername,
          runtime,
          pace,
        });
        await tailWait(adminPage, pace);

        for (const seat of seats) {
          await seat.page.screenshot({
            path: path.join(SCREENSHOT_DIR, `rehearsal-${seat.persona.username}.png`),
            fullPage: true,
          });
        }
        await adminPage.screenshot({
          path: path.join(SCREENSHOT_DIR, "rehearsal-admin.png"),
          fullPage: true,
        });
      }

      // ---------- 3. Pre-live / pre-replay reset ---------------------
      // Always sweep before pass 2 so any leftover orphan events (from
      // pass 1, or from a previous interrupted run) don't get bundled
      // into the recording we're about to make. For replay-only mode
      // we still ensure status=live, but no sweep is needed (we're not
      // recording).
      if (phases.has("live")) {
        adminToken = await getAdminToken();
        await sweepStageIfNeeded(runtime.stageId, adminToken);
        await setStageStatus(runtime.stageId, "live", adminToken);
        // status is now live — that's the validator-required end state,
        // so the finally block doesn't need to restore.
        needsStatusRestore = false;

        // Cast clients still hold pass-1 board state in their local Vuex.
        // Without a reload, pass 2's `enter` beats would add SECOND avatars
        // (new uuids), and admin/audience would see double of every persona.
        // Only needed when both phases ran on the same cast.
        if (phases.has("rehearsal")) {
          await reloadCastSeats({ admin: adminLive, adminPage, seats, runtime });
        }
      } else if (phases.has("replay")) {
        // Replay-only: ensure status=live so the validator and audience
        // route both work, but skip the sweep (we want the existing
        // Performance recordings preserved).
        adminToken = await getAdminToken();
        await setStageStatus(runtime.stageId, "live", adminToken);
        needsStatusRestore = false;
      }

      // ---------- 4. Audience joins (only if a phase needs them) -----
      if (needsAudience) {
        audience = await openAudienceSeat({ browser, runtime });
      }

      // ---------- 5. PASS 2 — live performance with audience ---------
      if (phases.has("live")) {
        console.log("[perform] PASS 2: live mode, audience present");
        await runPass({
          label: "live",
          beats,
          adminLive,
          viewerLive: audience!.live,
          seatByUsername,
          runtime,
          pace,
        });
        await tailWait(audience!.page, pace);

        for (const seat of seats) {
          await seat.page.screenshot({
            path: path.join(SCREENSHOT_DIR, `live-${seat.persona.username}.png`),
            fullPage: true,
          });
        }
        await adminPage.screenshot({
          path: path.join(SCREENSHOT_DIR, "live-admin.png"),
          fullPage: true,
        });
        await audience!.page.screenshot({
          path: path.join(SCREENSHOT_DIR, "live-audience.png"),
          fullPage: true,
        });
      }

      // Cast contexts have nothing more to do — pass 3 only exercises the
      // audience seat. Close now to free ~12 Chromium contexts before the
      // long replay wait. (No-op for rehearsal-only / replay-only modes
      // where seats is already empty or contexts already irrelevant.)
      for (const seat of seats) await seat.context.close();
      seats.length = 0;
      seatByUsername.clear();

      // ---------- 6. PASS 3 — replay --------------------------------
      if (phases.has("replay")) {
        let performanceId: number | null = null;
        if (phases.has("live")) {
          // Just finished pass 2: sweep its events into a fresh Performance
          // row. Wait for event_archive_dev to drain the MQTT tail first
          // so the recording isn't missing the last few lines.
          await audience!.page.waitForTimeout(eventArchiveSettleWaitMs(pace));
          adminToken = await getAdminToken();
          performanceId = await sweepStageReturningId(runtime.stageId, adminToken);
          if (performanceId == null) {
            console.warn(
              "[perform] PASS 3: pass 2 produced no events to archive — skipping replay.",
            );
          }
        } else {
          // Replay-only mode: pull the most recent existing Performance.
          adminToken = await getAdminToken();
          performanceId = await getMostRecentPerformanceId(runtime.stageId, adminToken);
          if (performanceId == null) {
            throw new Error(
              "[perform] PASS 3 (replay-only): no existing Performance for this stage. " +
                "Run with E2E_PHASES=live (or rehearsal,live) at least once first to record one.",
            );
          }
        }

        if (performanceId != null) {
          await runReplay({
            audience: audience!,
            stageSlug: runtime.stageSlug,
            performanceId,
            pace,
          });
        }
      }

      // ---------- 7. Audience teardown -----------------------------
      if (audience) {
        await audience.context.close();
        audience = null;
      }
      await adminCtx.close();
    } finally {
      // Best-effort cleanup of contexts opened in the try block. Closing
      // an already-closed context is a no-op (catch swallows the error).
      for (const seat of seats) {
        await seat.context.close().catch(() => {});
      }
      if (audience) {
        await audience.context.close().catch(() => {});
      }

      if (needsStatusRestore) {
        // Test bailed out after we'd already set status=rehearsal. Pin it
        // back to "live" so subsequent setup runs validate the existing
        // runtime.json instead of re-authoring from scratch. Tolerate
        // failure here: if the backend is unreachable the original error
        // matters more. Re-read the token in case the test ran past JWT
        // TTL (default 15min).
        try {
          const fresh = await getAdminToken();
          await setStageStatus(runtime.stageId, "live", fresh);
        } catch (e) {
          console.warn(
            `[perform] teardown: failed to restore status=live on stage ${runtime.stageId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// PASS RUNNER
// ---------------------------------------------------------------------------

/**
 * Walk every beat once. The `viewerLive` is the seat we assert visual
 * side-effects on (speech bubble + chat-log negative). In pass 1 that's the
 * admin (an authenticated observer). In pass 2 it's the unauthenticated
 * audience — proving the SPEAK MQTT message reached a non-cast viewer, which
 * is the same code path that drives meSpeak on their client.
 */
async function runPass({
  label,
  beats,
  adminLive,
  viewerLive,
  seatByUsername,
  runtime,
  pace,
}: {
  label: string;
  beats: readonly Beat[];
  adminLive: LiveStagePage;
  viewerLive: LiveStagePage;
  seatByUsername: Map<string, CastSeat>;
  runtime: RuntimeState;
  pace: PaceKind;
}): Promise<void> {
  for (const [i, beat] of beats.entries()) {
    await runBeat({ i, beat, adminLive, viewerLive, seatByUsername, runtime, label });
    const wait = pauseAfterBeatMs(beat, pace);
    if (wait > 0) await viewerLive["page"].waitForTimeout(wait);
  }
}

async function tailWait(page: Page, pace: PaceKind): Promise<void> {
  if (pace === "fast") return;
  // Give meSpeak room to finish the very last line + the bubble timer
  // (1s + 1s/word, capped by Topping's 5s) before we tear contexts down.
  await page.waitForTimeout(pace === "normal" ? 1500 : 2500);
}

// ---------------------------------------------------------------------------
// STAGE ADMIN HELPERS (sweep / status / audience entry / cast reload)
// ---------------------------------------------------------------------------

/**
 * Archive any unbound events on the stage into a fresh PerformanceModel and
 * return the new performance id. Returns `null` when the backend reports
 * `"The stage is already sweeped!"` (no orphan events to archive) — callers
 * that only care about idempotent cleanup ignore the return value, callers
 * that need the id (replay) treat null as "skip the next step".
 */
async function sweepStageReturningId(stageId: string, adminToken: string): Promise<number | null> {
  const result = await gql<{
    sweepStage: { success: boolean; performanceId: number | string };
  }>(
    `mutation SweepStage($id: ID!) {
       sweepStage(id: $id) { success performanceId }
     }`,
    { id: String(stageId) },
    adminToken,
  );
  if (result.errors?.length) {
    const messages = result.errors.map((e) => String(e.message)).join("; ");
    if (/already sweeped/i.test(messages)) {
      return null;
    }
    throw new Error(`[perform] sweepStage failed: ${messages}`);
  }
  if (!result.data?.sweepStage?.success) {
    throw new Error(`[perform] sweepStage returned non-success: ${JSON.stringify(result.data)}`);
  }
  const id = result.data.sweepStage.performanceId;
  if (id == null) {
    throw new Error(
      `[perform] sweepStage success but performanceId missing: ${JSON.stringify(result.data)}`,
    );
  }
  return Number(id);
}

/**
 * Idempotent variant: archive orphan events if any, ignore "already sweeped".
 * Used between passes where we just want to ensure no leftover events leak
 * into the next performance's recording.
 */
async function sweepStageIfNeeded(stageId: string, adminToken: string): Promise<void> {
  await sweepStageReturningId(stageId, adminToken);
}

/**
 * Look up the most recent `Performance` row for the stage and return its id,
 * or `null` if the stage has no recordings. Used by replay-only mode
 * (`E2E_PHASES=replay`) to point pass 3 at an existing recording instead
 * of trying to sweep a fresh one out of an empty event stream.
 *
 * Sort key is `createdOn` (descending); ties fall back to numeric id
 * descending so that two performances created in the same second still
 * resolve deterministically.
 */
async function getMostRecentPerformanceId(
  stageId: string,
  adminToken: string,
): Promise<number | null> {
  const result = await gql<{
    stage: { performances: Array<{ id: string; createdOn: string | null }> } | null;
  }>(
    `query StagePerformances($id: ID!) {
       stage(id: $id) { performances { id createdOn } }
     }`,
    { id: String(stageId) },
    adminToken,
  );
  if (result.errors?.length) {
    throw new Error(
      `[perform] getMostRecentPerformanceId failed: ${JSON.stringify(result.errors)}`,
    );
  }
  const performances = result.data?.stage?.performances ?? [];
  if (performances.length === 0) return null;
  const sorted = [...performances].sort((a, b) => {
    const ta = a.createdOn ? Date.parse(a.createdOn) : 0;
    const tb = b.createdOn ? Date.parse(b.createdOn) : 0;
    if (tb !== ta) return tb - ta;
    return Number(b.id) - Number(a.id);
  });
  return Number(sorted[0].id);
}

/**
 * Force the stage's stored `status` attribute to "rehearsal" or "live"
 * (idempotent). Use `updateStage` rather than `updateStatus` so we can pin
 * the value explicitly — `updateStatus` only TOGGLES, which is unsafe in a
 * suite that runs both passes back-to-back.
 *
 * `name` is omitted on purpose: it's optional in the GraphQL `StageInput`,
 * and `update_stage_attribute` skips falsy values so the name is preserved
 * by the resolver. Sending a placeholder name would silently rename the
 * stage as a side-effect.
 *
 * The mutation response now reflects hybrid-property values (cover /
 * visibility / status / playerAccess) — see the matching fix in
 * `stage.py::create_stage` and `update_stage`. Without that backend fix the
 * read-back below would always trip on `null`.
 */
async function setStageStatus(
  stageId: string,
  status: "rehearsal" | "live",
  adminToken: string,
): Promise<void> {
  const result = await gql<{ updateStage: { id: string; status: string } | null }>(
    `mutation SetStatus($input: StageInput!) {
       updateStage(input: $input) { id status }
     }`,
    {
      input: {
        id: String(stageId),
        status,
      },
    },
    adminToken,
  );
  if (result.errors?.length) {
    throw new Error(`[perform] setStageStatus(${status}) failed: ${JSON.stringify(result.errors)}`);
  }
  if (result.data?.updateStage?.status !== status) {
    throw new Error(
      `[perform] setStageStatus(${status}) did not persist (got ${
        result.data?.updateStage?.status ?? "null"
      }). Confirm stages/services/stage.py::update_stage merges hybrid props into the response dict.`,
    );
  }
}

/**
 * Open a brand-new browser context with no auth state, navigate to the live
 * stage URL, dismiss the LoginPrompt modal (audience entry), and wait for
 * MQTT to come up. Returns a seat-shaped object so existing
 * `LiveStagePage` helpers (speech bubble lookup, etc.) work the same way
 * as for cast seats.
 *
 * NOTE: this requires the stage to be in "live" status. In rehearsal the
 * SPA shows "not currently open to the public" and `LiveStagePage.goto`
 * throws — that's intentional and matches real audience UX.
 *
 * Two non-obvious things:
 * 1. `joinStage` is called AUTOMATICALLY on the `mqtt.client.connect`
 *    event (see `src/store/pinia/stage.ts` `connect` action). So the
 *    audience is subscribed to the stage's MQTT topics as soon as
 *    `stage.status` flips to "LIVE", *without* the human ever clicking
 *    the modal. Functionally we don't need to call `saveNickname` from
 *    the test.
 * 2. BUT the LoginPrompt modal's `.modal-background` is an opaque overlay
 *    (rgba(10,10,10,0.86)) covering the board. If we don't dismiss it,
 *    the human watching headed Chromium sees nothing happen on the
 *    audience seat. So we still have to click `.modal-background` to fire
 *    `enterAsAudience` → `close()` and reveal the board.
 *
 * The previous `.modal .modal-background` selector + plain `.click()` was
 * brittle: animejs runs a 1s rotate animation on `.modal-content` right
 * after mount, and Playwright's stability check can refuse the click. We
 * use `.modal.is-active` to target the visible LoginPrompt specifically,
 * `force: true` to skip stability, and a JS-level `.click()` event as a
 * fallback if Playwright's click somehow misses.
 */
async function openAudienceSeat({
  browser,
  runtime,
}: {
  browser: Browser;
  runtime: RuntimeState;
}): Promise<AudienceSeat> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const live = new LiveStagePage(page);
  await live.goto(runtime.stageSlug);

  console.log("[perform] audience: waiting for MQTT status=LIVE…");
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
    timeout: 30_000,
  });
  console.log("[perform] audience: MQTT LIVE ✓ (joinStage fired automatically)");

  // Wait for the LoginPrompt to actually mount and become active. It lives
  // inside `<template v-if="ready">` in Layout.vue, so it appears the same
  // tick the Pinia stage store's `ready` getter flips. We narrow to
  // `.modal.is-active` so the selector unambiguously points at LoginPrompt
  // (the only `.modal` that's is-active for an unauthenticated, just-
  // arrived visitor).
  const loginModal = page.locator(".modal.is-active").first();
  try {
    await loginModal.waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    console.warn(
      "[perform] audience: LoginPrompt modal never showed — already dismissed by an earlier auto-join? Continuing.",
    );
    return { context, page, live };
  }
  console.log("[perform] audience: LoginPrompt visible — dismissing…");

  // Strategy 1: Playwright click with force:true to bypass the animejs
  // rotation animation on .modal-content (which can fail Playwright's
  // actionability check on the sibling .modal-background).
  await loginModal
    .locator(".modal-background")
    .first()
    .click({ force: true, timeout: 5_000 })
    .catch((err) => {
      console.warn(
        `[perform] audience: Playwright click on .modal-background failed (${
          err instanceof Error ? err.message : String(err)
        }); falling back to JS dispatch.`,
      );
    });

  // Strategy 2: if the modal is still active after the click, fire a
  // synthetic click event on the same element from inside the page. This
  // bypasses every Playwright actionability concern because we're inside
  // the page's JS context invoking the DOM click() directly — Vue's bound
  // @click handler runs the same way it would for a real user click.
  const stillActive = await page
    .locator(".modal.is-active")
    .count()
    .catch(() => 0);
  if (stillActive > 0) {
    console.log("[perform] audience: modal still active — using JS-level dispatch fallback");
    await page.evaluate(() => {
      const bg = document.querySelector<HTMLElement>(".modal.is-active .modal-background");
      bg?.click();
    });
  }

  // Confirm the modal actually closed. If even the JS-level dispatch
  // didn't dismiss it, that's a real LoginPrompt regression we want to
  // surface — fail loudly rather than let pass 2 run with the audience
  // staring at an opaque overlay.
  await page.waitForFunction(() => document.querySelectorAll(".modal.is-active").length === 0, {
    timeout: 10_000,
  });
  console.log("[perform] audience: LoginPrompt dismissed ✓ — board visible");

  return { context, page, live };
}

/**
 * Force every cast seat to start pass 2 with a fresh local board. The DB-side
 * sweep doesn't broadcast anything, so without this each cast member would
 * still hold pass-1 avatars in their local Vuex. Their pass-2 `enter` beats
 * (new uuids) would then add a SECOND avatar per persona, which audience and
 * admin would both see double on, and any name-keyed lookup would race
 * between the two.
 *
 * `page.reload()` is the cleanest reset: vuex-persistedstate keeps the auth
 * token so re-login isn't needed; the SPA's normal Preloader path runs and
 * Vuex starts empty.
 */
async function reloadCastSeats({
  admin,
  adminPage,
  seats,
  runtime,
}: {
  admin: LiveStagePage;
  adminPage: Page;
  seats: CastSeat[];
  runtime: RuntimeState;
}): Promise<void> {
  for (const seat of seats) {
    await seat.page.reload();
    await seat.live.goto(runtime.stageSlug);
  }
  await adminPage.reload();
  await admin.goto(runtime.stageSlug);
}

// ---------------------------------------------------------------------------
// REPLAY (PASS 3)
// ---------------------------------------------------------------------------

/**
 * Navigate the audience seat to the SPA's actual replay route
 * (`/replay/:url/:id`), pin speed to 1x, call `stage.replayRecording`,
 * and wait for it to self-pause when the recording reaches its end.
 *
 * The caller supplies `performanceId`. Two callsites today:
 *
 *   1. After pass 2 (live), the caller sweeps the just-emitted events into
 *      a fresh Performance row and passes the new id here.
 *   2. In replay-only mode (E2E_PHASES=replay), the caller resolves the
 *      most recent existing Performance via `getMostRecentPerformanceId`
 *      and passes that id here.
 *
 * Why navigate instead of reusing `loadStage` via the dev hook:
 *
 *   `Topping.vue::shouldShowBubble` has an explicit
 *   `window.location.pathname.includes('/replay/')` short-circuit that is
 *   the ONLY thing keeping replayed bubbles on screen — without it, every
 *   bubble's `(now - speak.at) < 5s` check fails because `speak.at` is the
 *   original (now-stale) MQTT timestamp. Reusing the live URL with a
 *   dev-hook loadStage looks like it works (avatars place and move), but
 *   every speech bubble gets filtered out and the replay looks "silent".
 *
 *   Mounting the actual `views/replay/Layout.vue` also gives us the
 *   `provide("replaying", true)` injection some downstream components rely
 *   on, and skips the LoginPrompt modal entirely.
 *
 * Speed is pinned to 1x: scheduled future events go through `replayEvent`
 * (NOT `replicateEvent`), so they are NOT muted, so meSpeak fires for every
 * speech beat. Faster speeds chop or stack TTS audibly. (The on-screen
 * Controls bar lets a human override mid-replay if desired.)
 */
async function runReplay({
  audience,
  stageSlug,
  performanceId,
  pace,
}: {
  audience: AudienceSeat;
  stageSlug: string;
  performanceId: number;
  pace: PaceKind;
}): Promise<void> {
  console.log(
    `[perform] PASS 3: replay performance #${performanceId} on audience seat ` +
      `via /replay/${stageSlug}/${performanceId}`,
  );

  // Navigate the audience context to the proper replay URL. The SPA route
  // `/replay/:url/:id` mounts views/replay/Layout.vue which auto-calls
  // `stage.loadStage({url, recordId})` on setup.
  await audience.page.goto(`/replay/${stageSlug}/${performanceId}`);
  await audience.page.waitForLoadState("domcontentloaded");

  // The replay layout still uses the Preloader (with `replaying` class).
  // Once the model and assets have loaded the hero shows
  // "click anywhere to continue" — dismiss it the same way LiveStagePage.goto
  // does for the live route.
  const hero = audience.page.locator("section.hero.is-fullheight").first();
  await hero.waitFor({ state: "visible", timeout: 60_000 });
  const continueText = audience.page.getByText(/click anywhere to continue/i).first();
  if (await continueText.isVisible().catch(() => false)) {
    await hero.click();
  }
  await audience.page
    .locator('#board, [data-testid="board"]')
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });

  // Wait until loadStage has finished filling stage.replay.timestamp from
  // the recording's events (the dev hook is exposed by main.ts under
  // VITE_E2E, same as on the live route).
  await audience.page.waitForFunction(
    () => {
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        replay: { timestamp: { begin: number; end: number } };
        model: { events?: unknown[] } | null;
      };
      const ts = stage.replay?.timestamp;
      const events = stage.model?.events;
      return Boolean(ts && Number(ts.end) > Number(ts.begin) && events && events.length > 0);
    },
    { timeout: 30_000 },
  );

  // Pin speed=1 and snapshot the begin/end window so the wait loop has a
  // sane wall-clock bound. SET_REPLAY (now a Pinia method) merges into
  // stage.replay; replayRecording reads `stage.replay.speed` at the top of
  // the action.
  const { durationMs, eventCount } = await audience.page.evaluate(() => {
    const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
      replay: { timestamp: { begin: number; end: number }; speed: number };
      model: { events?: unknown[] } | null;
      SET_REPLAY: (p: { speed: number }) => void;
    };
    stage.SET_REPLAY({ speed: 1 });
    const ts = stage.replay.timestamp;
    // mqttTimestamp is POSIX seconds (event_archive subscriber writes
    // time.time()), so wall-clock duration at speed=1 is (end-begin)*1000.
    const seconds = Math.max(0, Number(ts.end) - Number(ts.begin));
    return {
      durationMs: Math.round(seconds * 1000),
      eventCount: stage.model?.events?.length ?? 0,
    };
  });
  console.log(
    `[perform] PASS 3: replay duration ≈ ${(durationMs / 1000).toFixed(1)}s @ 1x ` +
      `(${eventCount} events)`,
  );

  await audience.page.evaluate(async () => {
    const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
      replayRecording: () => unknown | Promise<unknown>;
    };
    await Promise.resolve(stage.replayRecording());
  });

  await audience.page.screenshot({
    path: path.join(SCREENSHOT_DIR, "replay-start.png"),
    fullPage: true,
  });

  // replayRecording installs a 1Hz interval that increments `current` and
  // fires `pauseReplay` (→ isReplaying=false) when current passes end.
  // Allow durationMs + a generous buffer for the last setTimeout to fire
  // and meSpeak's tail to drain.
  const tailMs = pace === "fast" ? 5_000 : pace === "normal" ? 15_000 : 30_000;
  const timeoutMs = durationMs + tailMs;
  await audience.page.waitForFunction(
    () => {
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        replay: { isReplaying: boolean };
      };
      return stage.replay.isReplaying === false;
    },
    { timeout: timeoutMs, polling: 500 },
  );
  await tailWait(audience.page, pace);

  await audience.page.screenshot({
    path: path.join(SCREENSHOT_DIR, "replay-end.png"),
    fullPage: true,
  });
}

// ---------------------------------------------------------------------------
// BEAT EXECUTION
// ---------------------------------------------------------------------------

async function runBeat({
  i,
  beat,
  adminLive,
  viewerLive,
  seatByUsername,
  runtime,
  label,
}: {
  i: number;
  beat: Beat;
  adminLive: LiveStagePage;
  viewerLive: LiveStagePage;
  seatByUsername: Map<string, CastSeat>;
  runtime: RuntimeState;
  label: string;
}): Promise<void> {
  const tag = `[${label}] beat[${i}] ${beat.kind}${beat.speaker ? ` <${beat.speaker}>` : ""}`;

  if (beat.kind === "backdrop") {
    // Admin owns backdrop changes. We do TWO things in lock-step:
    //
    //   1. GraphQL `updateStage(cover)` — persists the chosen backdrop as
    //      the stage's default. Anyone reloading later starts on this
    //      cover. This is what we used to do, alone — the bug was that
    //      it doesn't show up on already-connected clients in real time
    //      (cover only seeds `state.model.cover`, which Board.vue does
    //      not render; the live board image comes from `state.background`)
    //      AND it isn't broadcast over MQTT, so the event_archive worker
    //      never sees it and the recording can't replay it.
    //
    //   2. MQTT `stage.setBackground` — broadcasts a CHANGE_BACKGROUND
    //      event over TOPICS.BACKGROUND. Every connected client commits
    //      `SET_BACKGROUND`, which sets `state.background`, which is what
    //      `Backdrop.vue` actually renders. The event is also captured by
    //      event_archive_dev → swept into the Performance row → replayed
    //      by `replayRecording` → fires `SET_BACKGROUND` again on the
    //      audience seat in pass 3.
    const ref = beat.backdrop ? runtime.backdrops[beat.backdrop] : undefined;
    if (!ref) throw new Error(`${tag}: unknown backdrop key ${beat.backdrop}`);

    // 1. Persist via GraphQL.
    await adminLive["page"].evaluate(
      async ({ stageId, mediaId }) => {
        // Auth lives at `upstage-auth` (Pinia) since Phase 5; fall back to
        // the legacy `vuex` key so a stale tab still yields a token.
        const readToken = (): string | null => {
          for (const key of ["upstage-auth", "vuex"] as const) {
            const raw = window.localStorage.getItem(key);
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw) as { token?: string; auth?: { token?: string } };
              const t = parsed?.token ?? parsed?.auth?.token ?? null;
              if (t) return t;
            } catch {
              /* ignore */
            }
          }
          return null;
        };
        const token = readToken();
        if (!token) throw new Error("no admin token in localStorage");
        const gqlHeaders = {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        };

        const stageResp = await fetch("/api/studio_graphql", {
          method: "POST",
          headers: gqlHeaders,
          body: JSON.stringify({
            query: `query StageBackdropAsset($id: ID!) {
            stage(id: $id) {
              assets { id fileLocation }
            }
          }`,
            variables: { id: String(stageId) },
          }),
        });
        const stageJson = await stageResp.json();
        if (stageJson.errors) throw new Error(JSON.stringify(stageJson.errors));
        const assets = stageJson.data?.stage?.assets ?? [];
        const asset = assets.find((a: { id: string }) => String(a.id) === String(mediaId));
        if (!asset?.fileLocation) {
          throw new Error(`backdrop asset ${mediaId} not found on stage or missing fileLocation`);
        }

        const resp = await fetch("/api/studio_graphql", {
          method: "POST",
          headers: gqlHeaders,
          body: JSON.stringify({
            query: `mutation SaveBackdropCover($input: StageInput!) {
            updateStage(input: $input) { id cover }
          }`,
            variables: {
              input: {
                id: String(stageId),
                cover: asset.fileLocation,
              },
            },
          }),
        });
        const result = await resp.json();
        if (result.errors) throw new Error(JSON.stringify(result.errors));
      },
      { stageId: runtime.stageId, mediaId: ref.id },
    );

    // 2. Broadcast over MQTT from the admin's seat. We pull the backdrop
    //    object straight out of `stage.tools.backdrops` because that
    //    is exactly what the real toolbox UI passes to setBackground —
    //    same `id`, `src` (already absolutized by SET_MODEL), and any
    //    multi-frame metadata. SET_BACKGROUND does change-detection on
    //    `id` and `at`, so a synthetic minimal object would risk being
    //    dropped on observers that already saw a same-id no-op.
    await adminLive["page"].evaluate(
      async ({ mediaId }) => {
        type Backdrop = Record<string, unknown> & { id: string | number };
        const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
          tools: { backdrops?: Backdrop[] };
          status: string;
          setBackground: (b: Backdrop) => unknown | Promise<unknown>;
        };

        const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

        // Toolbox is populated by SET_MODEL after `loadStage` resolves; on a
        // freshly reloaded admin page it may not be there yet. Poll briefly.
        let backdrop: Backdrop | undefined;
        for (let attempt = 0; attempt < 60; attempt += 1) {
          const list = stage.tools.backdrops ?? [];
          backdrop = list.find((b) => String(b.id) === String(mediaId));
          if (backdrop) break;
          await sleep(250);
        }
        if (!backdrop) {
          const ids = (stage.tools.backdrops ?? []).map((b) => String(b.id)).join(", ");
          throw new Error(
            `setBackground: backdrop ${mediaId} not in admin tools.backdrops; available: [${ids}]`,
          );
        }

        // setBackground stamps `at = +new Date()` itself before publishing,
        // so we don't need to set it. MQTT must be LIVE on the admin page
        // (it always is — admin has been on the stage since the start), but
        // assert just in case so a regression here surfaces clearly.
        if (stage.status !== "LIVE") {
          throw new Error(`setBackground: admin MQTT status=${stage.status}, expected LIVE`);
        }
        await Promise.resolve(stage.setBackground(backdrop));
      },
      { mediaId: ref.id },
    );
    return;
  }

  const seat = seatByUsername.get(beat.speaker);
  if (!seat) {
    if (beat.kind === "exit") return; // optional persona left.
    throw new Error(`${tag}: speaker ${beat.speaker} has no live seat`);
  }

  if (beat.kind === "enter") {
    // Avatars are placed from the toolbox via drag/drop; we shortcut through
    // the Pinia stage store (same as Board.vue) plus shapeObject(liveAction)
    // so MQTT reaches observers.
    const mediaRef = runtime.mediaByPersona[beat.speaker];
    if (!mediaRef) throw new Error(`${tag}: no avatar media for ${beat.speaker}`);
    await placeAvatar({
      seat,
      mediaId: mediaRef.id,
      mediaName: mediaRef.name,
      to: beat.to ?? { x: 480, y: 280 },
      // Carry the persona's meSpeak voice on the placed object so observers'
      // TTS uses it. `avatarSpeak` short-circuits unless `avatar.voice.voice`
      // is set, so without this every speak beat is silent in headed runs.
      voice: seat.persona.voice,
    });
    // Assert the avatar is visible to the viewer (admin in pass 1, audience
    // in pass 2). The audience case is the load-bearing one: it proves the
    // PLACE_OBJECT_ON_STAGE MQTT broadcast reached an unauthenticated client.
    await expect
      .poll(async () => await viewerLive.objectByName(mediaRef.name).count(), { timeout: 12_000 })
      .toBeGreaterThan(0);
    return;
  }

  if (beat.kind === "exit") {
    // Soft exit: just walk the avatar offstage. We don't delete the object,
    // so a follow-up beat can reference it again.
    return;
  }

  if (beat.kind === "move") {
    const mediaRef = runtime.mediaByPersona[beat.speaker];
    if (!mediaRef) return;
    // We call `stage.shapeObject` directly rather than driving a pointer
    // drag through the DOM. With liveAction: true on an already-published
    // object this emits BOARD_ACTIONS.MOVE_TO over MQTT for every observer —
    // exactly what a real drag does on dragEnd. Avoids the fragility of
    // pointer-timing and works regardless of viewport/zoom.
    await moveAvatar({
      seat,
      mediaName: mediaRef.name,
      to: beat.to ?? { x: 500, y: 300 },
    });
    return;
  }

  if (beat.kind === "speak" || beat.kind === "shout" || beat.kind === "think") {
    if (!beat.line) throw new Error(`${tag}: missing line`);
    // Players speak in-world: their line is the avatar's voice (TTS via
    // meSpeak) and a transient bubble over the avatar (Topping.vue), and is
    // *not* an OOC chat-panel message. We call `stage.speakAsAvatar`
    // (TOPICS.BOARD/SPEAK only — no TOPICS.CHAT) instead of typing into the
    // chat input.
    await speakAsAvatar({ seat, message: beat.line, behavior: beat.kind });

    const mediaRef = runtime.mediaByPersona[beat.speaker];
    if (mediaRef) {
      // The bubble showing on the *viewer* is proof that SPEAK round-tripped
      // to a non-speaker client. SET_OBJECT_SPEAK then calls avatarSpeak() on
      // every observer (gated by `stage.status === "LIVE"`, which is the
      // MQTT lifecycle state — green by the time MQTT delivered this event),
      // so a visible bubble is the same code-path proof that meSpeak fired.
      // In pass 2 the viewer is the audience, which is the case the human
      // operator actually wants to hear.
      await expect(viewerLive.speechBubbleFor(mediaRef.name)).toBeVisible({
        timeout: 8_000,
      });

      // Negative assertion: player speech must NOT pollute the public chat
      // log. We sample the first few words of the line; for shouts,
      // speakAsAvatar uppercases the message, so we check both forms.
      const expectedPrefix = beat.line.split(/\s+/).slice(0, 4).join(" ");
      const needles =
        beat.kind === "shout" ? [expectedPrefix, expectedPrefix.toUpperCase()] : [expectedPrefix];
      for (const needle of needles) {
        await expect(viewerLive.chatLogEntryFor(mediaRef.name, needle)).toHaveCount(0, {
          timeout: 1_000,
        });
      }
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// SEAT-LEVEL PINIA HELPERS (speak / place / move)
// ---------------------------------------------------------------------------

/**
 * Drive in-world avatar speech (bubble + meSpeak TTS) from the speaker's seat
 * by calling `stage.speakAsAvatar` directly via the Pinia dev hook. This
 * intentionally skips the chat input / `stage.sendChat` path so the line does
 * NOT appear in the public chat log — matching how player speech behaves in
 * the real app (in-world performance, not OOC chat).
 *
 * Throws if the seat has no held avatar or `canPlay` is false (rather than
 * silently no-opping like the underlying action) so test failures point at
 * the real cause: the speaker isn't actually on stage / hasn't been granted
 * player permissions.
 */
async function speakAsAvatar({
  seat,
  message,
  behavior,
}: {
  seat: CastSeat;
  message: string;
  behavior: "speak" | "shout" | "think";
}): Promise<void> {
  await seat.page.evaluate(
    async ({ message, behavior }) => {
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        currentAvatar: unknown;
        canPlay: boolean;
        speakAsAvatar: (p: { message: string; behavior: string }) => unknown | Promise<unknown>;
      };
      if (!stage.currentAvatar) {
        throw new Error(
          "speakAsAvatar: no currentAvatar held — the speaker hasn't entered or `enter` did not publish.",
        );
      }
      if (!stage.canPlay) {
        throw new Error(
          "speakAsAvatar: canPlay=false on this seat — backend permission resolution did not grant `player`.",
        );
      }
      await Promise.resolve(stage.speakAsAvatar({ message, behavior }));
    },
    { message, behavior },
  );
}

async function placeAvatar({
  seat,
  mediaId,
  mediaName,
  to,
  voice,
}: {
  seat: CastSeat;
  mediaId: string;
  mediaName: string;
  to: { x: number; y: number };
  voice?: AvatarVoice;
}): Promise<void> {
  await seat.page.evaluate(
    async ({ mediaId, mediaName, to, voice }) => {
      type ToolboxAvatar = Record<string, unknown> & { id: unknown };
      type BoardObject = Record<string, unknown> & { id: string };
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        status: string;
        tools: { avatars?: ToolboxAvatar[] };
        board: { objects: BoardObject[] };
        placeObjectOnStage: (p: unknown) => { id: string };
        shapeObject: (p: unknown) => unknown | Promise<unknown>;
      };

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (stage.status === "LIVE") break;
        await sleep(250);
      }
      if (stage.status !== "LIVE") {
        throw new Error(
          `stage MQTT not LIVE yet (status=${stage.status}); cannot broadcast avatar placement.`,
        );
      }

      let avatar: ToolboxAvatar | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const avatars = stage.tools.avatars ?? [];
        avatar =
          avatars.find((a) => a.name === mediaName) ??
          avatars.find((a) => String(a.id) === String(mediaId));
        if (avatar) break;
        await sleep(250);
      }
      if (!avatar) {
        const avatars = stage.tools.avatars ?? [];
        const ids = avatars.map((a) => String(a.id)).join(", ");
        throw new Error(
          `avatar not in toolbox (name=${mediaName}, id=${mediaId}); known ids: [${ids}]`,
        );
      }

      // `placeObjectOnStage` spreads the toolbox avatar's defaults FIRST then
      // our payload, so anything set here wins. We always include the persona's
      // meSpeak voice (when provided) as `object.voice` so:
      //   1. The placed object's MQTT broadcast carries the voice → every
      //      observer's local `stage.board.objects[i].voice` is set →
      //      `SET_OBJECT_SPEAK` → `avatarSpeak(model, …)` actually fires
      //      meSpeak instead of short-circuiting on `!avatar.voice.voice`.
      //   2. The speaker also hears their own voice locally.
      // Pinia's placeObjectOnStage is synchronous and returns the new object.
      const placed = stage.placeObjectOnStage({
        ...avatar,
        ...(voice ? { voice } : {}),
        name: mediaName,
        x: to.x,
        y: to.y,
      });

      const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
      if (!fromBoard) {
        throw new Error("placeObjectOnStage did not add object to board.objects");
      }

      await Promise.resolve(
        stage.shapeObject({
          ...fromBoard,
          liveAction: true,
          published: false,
        }),
      );
    },
    { mediaId, mediaName, to, voice },
  );
}

async function moveAvatar({
  seat,
  mediaName,
  to,
}: {
  seat: CastSeat;
  mediaName: string;
  to: { x: number; y: number };
}): Promise<void> {
  await seat.page.evaluate(
    async ({ mediaName, to }) => {
      type BoardObject = Record<string, unknown> & {
        id: string;
        name?: string;
        published?: boolean;
      };
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        board: { objects: BoardObject[] };
        shapeObject: (p: unknown) => unknown | Promise<unknown>;
      };

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      // Object placement is async (MQTT round-trip via shapeObject in placeAvatar);
      // a follow-up move beat may run before the seat's local board state has
      // settled. Poll briefly so we don't race the placement.
      let target: BoardObject | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        target = stage.board.objects.find((o) => o.name === mediaName);
        if (target) break;
        await sleep(150);
      }
      if (!target) {
        throw new Error(`move: object name=${mediaName} not in board.objects on this seat`);
      }

      // shapeObject with liveAction: true emits BOARD_ACTIONS.MOVE_TO when the
      // object is already published (placeAvatar publishes on enter), or
      // PLACE_OBJECT_ON_STAGE if not — either way observers see the new x/y.
      await Promise.resolve(
        stage.shapeObject({
          ...target,
          x: to.x,
          y: to.y,
          liveAction: true,
          published: target.published ?? true,
        }),
      );
    },
    { mediaName, to },
  );
}
