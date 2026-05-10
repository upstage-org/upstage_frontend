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
 */
function shouldRunReplay(): boolean {
  const explicit = process.env.E2E_REPLAY?.trim().toLowerCase();
  if (explicit === "1" || explicit === "true") return true;
  if (explicit === "0" || explicit === "false") return false;
  return !loadE2eConfig().headless;
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
    const runReplayPhase = shouldRunReplay();
    console.log(
      `[perform] pace=${pace} headless=${loadE2eConfig().headless} replay=${runReplayPhase}`,
    );

    // ---------- 0. Spin up admin browser FIRST --------------------------
    // The backend deletes prior UserSessionModel rows on each login (single-
    // session-per-user policy). If we did `loginAsAdmin()` from Node first,
    // then ran `adminLogin.login()` in the browser, the Node-side token
    // would be invalidated mid-test — fine for the first batch of GraphQL
    // calls below, but we'd hit "Authenticated Failed" on the cross-pass
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

    // ---------- 1. Reset stage state for this run -----------------------
    // Sweep first so any stray events from prior runs are archived.
    let adminToken = await getAdminToken();
    await sweepStageIfNeeded(runtime.stageId, adminToken);

    // Always restore status="live" before exit (success OR failure) so the
    // next run's `validate-runtime.ts` reuses this stage instead of re-
    // authoring from scratch. The validator requires status === "live".
    let needsStatusRestore = true;

    try {

    // Force rehearsal for pass 1. The stored attribute gates audience entry
    // (rehearsal locks out non-players); it does NOT gate meSpeak — the TTS
    // gate is `state.status === "LIVE"` (the MQTT lifecycle field), which
    // every connected client reaches independently.
    await setStageStatus(runtime.stageId, "rehearsal", adminToken);

    const beats = process.env.E2E_BEATS === "smoke" ? SMOKE_BEATS : BEATS;
    expect(beats.length).toBeGreaterThan(0);

    const seats: CastSeat[] = [];
    for (const persona of PERSONAS) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const lp = new LoginPage(page);
      await lp.login(persona.username, persona.password);
      const live = new LiveStagePage(page);
      await live.goto(runtime.stageSlug);
      seats.push({ persona, context: ctx, page, live });
    }
    const seatByUsername = new Map(seats.map((s) => [s.persona.username, s] as const));

    // ---------- 2. PASS 1 — rehearsal walkthrough -----------------------
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

    // Per-cast snapshot of the rehearsal end state, before we wipe and re-do.
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

    // ---------- 3. Reset between passes ---------------------------------
    // Sweep archives every event from pass 1, but the cast clients still
    // hold pass-1 board state in their local Vuex. Without a reload, when
    // pass 2's `enter` beats place fresh avatars (new uuids), each cast
    // member's local board would carry both copies — admin would see two
    // of every persona, and pass 2's `move` lookups by name would race.
    //
    // Token may have expired during the multi-minute pass 1 (default JWT
    // TTL is 15 minutes; slow pace + a long script gets close). Re-read
    // from the admin browser, which holds the only live admin session.
    adminToken = await getAdminToken();
    await sweepStageIfNeeded(runtime.stageId, adminToken);
    await setStageStatus(runtime.stageId, "live", adminToken);
    await reloadCastSeats({ admin: adminLive, adminPage, seats, runtime });

    // ---------- 4. Audience joins (no login) ---------------------------
    const audience = await openAudienceSeat({ browser, runtime });

    // ---------- 5. PASS 2 — live performance with audience watching ----
    console.log("[perform] PASS 2: live mode, audience present");
    await runPass({
      label: "live",
      beats,
      adminLive,
      viewerLive: audience.live,
      seatByUsername,
      runtime,
      pace,
    });
    await tailWait(audience.page, pace);

    // ---------- 6. Live-end screenshots ---------------------------------
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
    await audience.page.screenshot({
      path: path.join(SCREENSHOT_DIR, "live-audience.png"),
      fullPage: true,
    });

    // Cast contexts have nothing more to do — pass 3 only exercises the
    // audience seat (replay loads the recorded performance there). Closing
    // them now frees ~12 Chromium contexts before the long replay wait.
    for (const seat of seats) await seat.context.close();

    // ---------- 7. PASS 3 — audience replay (optional) -----------------
    if (runReplayPhase) {
      // Let the event_archive worker drain the tail of pass 2 into the DB
      // before we sweep, otherwise the Performance row would be missing the
      // last few events and the replay would cut short.
      await audience.page.waitForTimeout(eventArchiveSettleWaitMs(pace));
      // JWT may have aged out across two long passes; refresh from the
      // admin browser, which holds the only live admin session.
      adminToken = await getAdminToken();
      await runReplay({
        audience,
        stageId: runtime.stageId,
        stageSlug: runtime.stageSlug,
        adminToken,
        pace,
      });
    } else {
      console.log("[perform] PASS 3 skipped (E2E_REPLAY=0 or headless run).");
    }

    await audience.context.close();
    await adminCtx.close();

    // We finished pass 2 in live mode, so status is already "live". Skip
    // the extra mutation in the finally block.
    needsStatusRestore = false;

    } finally {
      if (needsStatusRestore) {
        // The test bailed out partway through. Pin the stage back to "live"
        // so subsequent setup runs validate the existing runtime.json
        // instead of re-authoring from scratch. We tolerate failure here:
        // if the backend is unreachable the original error matters more.
        // Re-read the token from the admin browser in case the long pass
        // ran past the JWT TTL (default 15min).
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
async function sweepStageReturningId(
  stageId: string,
  adminToken: string,
): Promise<number | null> {
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
 * stage URL, dismiss the LoginPrompt as audience, and wait for MQTT to come
 * up. Returns a seat-shaped object so existing `LiveStagePage` helpers
 * (speech bubble lookup, etc.) work the same way as for cast seats.
 *
 * NOTE: this requires the stage to be in "live" status. In rehearsal the
 * SPA shows "not currently open to the public" and `LiveStagePage.goto`
 * throws — that's intentional and matches real audience UX.
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

  // The LoginPrompt modal sits on top of the board for any unauthenticated
  // visitor. Clicking `.modal-background` triggers `enterAsAudience` which
  // dispatches `user/saveNickname` (which in turn dispatches `joinStage`)
  // and closes the modal.
  const modalBg = page.locator(".modal .modal-background").first();
  await modalBg.waitFor({ state: "visible", timeout: 10_000 });
  await modalBg.click();

  // Wait for MQTT to flip the runtime status to LIVE on this client. Without
  // this, the next SPEAK arriving here would be silently mute-gated by
  // SET_OBJECT_SPEAK (`state.status === "LIVE"` is the gate that controls
  // whether avatarSpeak / meSpeak fires).
  await page.waitForFunction(
    () => {
      const store = (
        window as unknown as { __UPSTAGE_STORE__?: { state: { stage: { status: string } } } }
      ).__UPSTAGE_STORE__;
      return store?.state?.stage?.status === "LIVE";
    },
    { timeout: 30_000 },
  );

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
 * Sweep pass 2's events into a Performance row, reload the audience seat with
 * that recordId so its Vuex picks up `state.model.events` and
 * `state.replay.timestamp.{begin,end}`, then dispatch `stage/replayRecording`
 * and wait for the SPA to flip `state.replay.isReplaying` back to false.
 *
 * Speed is pinned to 1x: scheduled future events are dispatched via
 * `replayEvent` (NOT `replicateEvent`), so they are NOT muted, so meSpeak
 * fires for every speech beat. Faster speeds chop or stack TTS audibly.
 *
 * If sweepStage reports there were no events to archive (which can only
 * happen if pass 2 emitted nothing — usually a real bug we want surfaced —
 * but also the case in a smoke run where one of the cast races MQTT), we
 * log a warning and skip the replay rather than failing the whole test.
 */
async function runReplay({
  audience,
  stageId,
  stageSlug,
  adminToken,
  pace,
}: {
  audience: AudienceSeat;
  stageId: string;
  stageSlug: string;
  adminToken: string;
  pace: PaceKind;
}): Promise<void> {
  const performanceId = await sweepStageReturningId(stageId, adminToken);
  if (performanceId == null) {
    console.warn(
      "[perform] PASS 3: sweepStage reports no events to archive — skipping replay.",
    );
    return;
  }
  console.log(`[perform] PASS 3: replay performance #${performanceId} on audience seat`);

  // Reload the audience SPA against the new performanceId so `loadStage`
  // pulls just THIS performance's events. We hit `stage/loadStage` directly
  // through the dev-store hook (same path as `Live.vue`'s preloader) so we
  // don't have to construct a /record/<id>/<slug> URL by hand.
  const eventCount = await audience.page.evaluate(
    async ({ url, recordId }) => {
      type DevStore = {
        dispatch: (type: string, payload?: unknown) => Promise<unknown>;
        state: { stage: { model: { events?: unknown[] } } };
      };
      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      if (!store) throw new Error("Vuex store not exposed (__UPSTAGE_STORE__).");
      await store.dispatch("stage/loadStage", { url, recordId });
      return store.state.stage.model.events?.length ?? 0;
    },
    { url: stageSlug, recordId: performanceId },
  );
  if (eventCount === 0) {
    throw new Error(
      `[perform] PASS 3: loadStage returned 0 events for performance ${performanceId} — ` +
        "the recording is empty. Check that event_archive_dev was running during pass 2.",
    );
  }

  // Pin speed=1 BEFORE starting playback. SET_REPLAY merges into state.replay
  // and replayRecording reads `state.replay.speed` at the top of the action.
  // Snapshot the begin/end window in the same evaluate so the wait loop has
  // a sane wall-clock bound.
  const { durationMs } = await audience.page.evaluate(() => {
    type ReplayState = {
      timestamp: { begin: number; end: number };
      speed: number;
    };
    type DevStore = {
      commit: (type: string, payload?: unknown) => void;
      state: { stage: { replay: ReplayState } };
    };
    const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
    if (!store) throw new Error("Vuex store not exposed.");
    store.commit("stage/SET_REPLAY", { speed: 1 });
    const ts = store.state.stage.replay.timestamp;
    // mqttTimestamp is POSIX seconds (event_archive subscriber writes
    // time.time()), so wall-clock duration at speed=1 is (end-begin)*1000.
    const seconds = Math.max(0, Number(ts.end) - Number(ts.begin));
    return { durationMs: Math.round(seconds * 1000) };
  });
  console.log(
    `[perform] PASS 3: replay duration ≈ ${(durationMs / 1000).toFixed(1)}s @ 1x ` +
      `(${eventCount} events)`,
  );

  await audience.page.evaluate(async () => {
    type DevStore = {
      dispatch: (type: string, payload?: unknown) => Promise<unknown>;
    };
    const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
    if (!store) throw new Error("Vuex store not exposed.");
    await store.dispatch("stage/replayRecording");
  });

  await audience.page.screenshot({
    path: path.join(SCREENSHOT_DIR, "replay-start.png"),
    fullPage: true,
  });

  // The action installs a 1Hz interval that increments `current` and fires
  // `pauseReplay` when current passes end, which sets isReplaying=false.
  // Allow durationMs + a generous buffer for the last setTimeout to fire
  // and meSpeak's tail to drain. tailWait shape mirrored from pass 2.
  const tailMs = pace === "fast" ? 5_000 : pace === "normal" ? 15_000 : 30_000;
  const timeoutMs = durationMs + tailMs;
  await audience.page.waitForFunction(
    () => {
      type DevStore = { state: { stage: { replay: { isReplaying: boolean } } } };
      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      return store?.state?.stage?.replay?.isReplaying === false;
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
    // Admin owns backdrop changes. We reach into the SPA's GraphQL directly
    // because the live UI for backdrop swap is buried in a context menu we
    // don't drive with Playwright clicks.
    const ref = beat.backdrop ? runtime.backdrops[beat.backdrop] : undefined;
    if (!ref) throw new Error(`${tag}: unknown backdrop key ${beat.backdrop}`);
    await adminLive["page"].evaluate(async ({ stageId, mediaId }) => {
      const raw = window.localStorage.getItem("vuex");
      const token = raw ? (JSON.parse(raw)?.auth?.token ?? null) : null;
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
        throw new Error(
          `backdrop asset ${mediaId} not found on stage or missing fileLocation`,
        );
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
    }, { stageId: runtime.stageId, mediaId: ref.id });
    return;
  }

  const seat = seatByUsername.get(beat.speaker);
  if (!seat) {
    if (beat.kind === "exit") return; // optional persona left.
    throw new Error(`${tag}: speaker ${beat.speaker} has no live seat`);
  }

  if (beat.kind === "enter") {
    // Avatars are placed from the toolbox via drag/drop; we shortcut through Vuex
    // (same as Board.vue) plus shapeObject(liveAction) so MQTT reaches observers.
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
      .poll(
        async () => await viewerLive.objectByName(mediaRef.name).count(),
        { timeout: 12_000 },
      )
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
    // We dispatch `stage/shapeObject` directly rather than driving a pointer
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
    // *not* an OOC chat-panel message. We dispatch `stage/speakAsAvatar`
    // (TOPICS.BOARD/SPEAK only — no TOPICS.CHAT) instead of typing into the
    // chat input.
    await speakAsAvatar({ seat, message: beat.line, behavior: beat.kind });

    const mediaRef = runtime.mediaByPersona[beat.speaker];
    if (mediaRef) {
      // The bubble showing on the *viewer* is proof that SPEAK round-tripped
      // to a non-speaker client. SET_OBJECT_SPEAK then calls avatarSpeak() on
      // every observer (gated by `state.status === "LIVE"`, which is the
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
      const needles = beat.kind === "shout"
        ? [expectedPrefix, expectedPrefix.toUpperCase()]
        : [expectedPrefix];
      for (const needle of needles) {
        await expect(
          viewerLive.chatLogEntryFor(mediaRef.name, needle),
        ).toHaveCount(0, { timeout: 1_000 });
      }
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// SEAT-LEVEL VUEX HELPERS (speak / place / move)
// ---------------------------------------------------------------------------

/**
 * Drive in-world avatar speech (bubble + meSpeak TTS) from the speaker's seat
 * by dispatching `stage/speakAsAvatar` directly via the dev-store hook. This
 * intentionally skips the chat input / `stage/sendChat` path so the line does
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
      type DevStore = {
        dispatch: (type: string, payload?: unknown) => Promise<unknown>;
        getters: Record<string, unknown>;
      };
      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      if (!store) {
        throw new Error("Vuex store not exposed (__UPSTAGE_STORE__).");
      }
      const avatar = store.getters["stage/currentAvatar"];
      if (!avatar) {
        throw new Error(
          "speakAsAvatar: no currentAvatar held — the speaker hasn't entered or `enter` did not publish.",
        );
      }
      const canPlay = store.getters["stage/canPlay"];
      if (!canPlay) {
        throw new Error(
          "speakAsAvatar: canPlay=false on this seat — backend permission resolution did not grant `player`.",
        );
      }
      await store.dispatch("stage/speakAsAvatar", { message, behavior });
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
      type StageSlice = {
        status: string;
        tools: { avatars?: ToolboxAvatar[] };
        board: { objects: Array<Record<string, unknown> & { id: string }> };
      };
      type DevStore = {
        dispatch: (type: string, payload?: unknown) => Promise<unknown>;
        state: { stage: StageSlice };
      };

      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      if (!store) {
        throw new Error(
          "Vuex store not exposed (__UPSTAGE_STORE__). Serve the SPA with `pnpm dev` for perform E2E.",
        );
      }

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (store.state.stage.status === "LIVE") break;
        await sleep(250);
      }
      if (store.state.stage.status !== "LIVE") {
        throw new Error(
          `stage MQTT not LIVE yet (status=${store.state.stage.status}); cannot broadcast avatar placement.`,
        );
      }

      let avatar: ToolboxAvatar | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const avatars = store.state.stage.tools.avatars ?? [];
        avatar =
          avatars.find((a) => a.name === mediaName) ??
          avatars.find((a) => String(a.id) === String(mediaId));
        if (avatar) break;
        await sleep(250);
      }
      if (!avatar) {
        const avatars = store.state.stage.tools.avatars ?? [];
        const ids = avatars.map((a) => String(a.id)).join(", ");
        throw new Error(
          `avatar not in toolbox (name=${mediaName}, id=${mediaId}); known ids: [${ids}]`,
        );
      }

      // `placeObjectOnStage` spreads the toolbox avatar's defaults FIRST then
      // our payload, so anything set here wins. We always include the persona's
      // meSpeak voice (when provided) as `object.voice` so:
      //   1. The placed object's MQTT broadcast carries the voice → every
      //      observer's local `state.board.objects[i].voice` is set →
      //      `SET_OBJECT_SPEAK` → `avatarSpeak(model, …)` actually fires
      //      meSpeak instead of short-circuiting on `!avatar.voice.voice`.
      //   2. The speaker also hears their own voice locally.
      const placed = (await store.dispatch("stage/placeObjectOnStage", {
        ...avatar,
        ...(voice ? { voice } : {}),
        name: mediaName,
        x: to.x,
        y: to.y,
      })) as { id: string };

      const fromBoard = store.state.stage.board.objects.find((o) => o.id === placed.id);
      if (!fromBoard) {
        throw new Error("placeObjectOnStage did not add object to board.objects");
      }

      await store.dispatch("stage/shapeObject", {
        ...fromBoard,
        liveAction: true,
        published: false,
      });
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
      type StageSlice = {
        board: { objects: Array<Record<string, unknown> & { id: string; name?: string; published?: boolean }> };
      };
      type DevStore = {
        dispatch: (type: string, payload?: unknown) => Promise<unknown>;
        state: { stage: StageSlice };
      };

      const store = (window as unknown as { __UPSTAGE_STORE__?: DevStore }).__UPSTAGE_STORE__;
      if (!store) {
        throw new Error("Vuex store not exposed (__UPSTAGE_STORE__).");
      }

      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      // Object placement is async (MQTT round-trip via shapeObject in placeAvatar);
      // a follow-up move beat may run before the seat's local board state has
      // settled. Poll briefly so we don't race the placement.
      let target: (Record<string, unknown> & { id: string; published?: boolean }) | undefined;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        target = store.state.stage.board.objects.find(
          (o) => o.name === mediaName,
        );
        if (target) break;
        await sleep(150);
      }
      if (!target) {
        throw new Error(
          `move: object name=${mediaName} not in board.objects on this seat`,
        );
      }

      // shapeObject with liveAction: true emits BOARD_ACTIONS.MOVE_TO when the
      // object is already published (placeAvatar publishes on enter), or
      // PLACE_OBJECT_ON_STAGE if not — either way observers see the new x/y.
      await store.dispatch("stage/shapeObject", {
        ...target,
        x: to.x,
        y: to.y,
        liveAction: true,
        published: target.published ?? true,
      });
    },
    { mediaName, to },
  );
}
