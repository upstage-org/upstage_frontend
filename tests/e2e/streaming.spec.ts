/**
 * Streaming end-to-end test: a performer streams live, an audience views it.
 *
 * Two surfaces are exercised:
 *
 *   1. Embedded MeetingObject — the post-"option B" `<iframe>` embed in
 *      `src/components/objects/MeetingObject/index.vue`. The contract this
 *      test verifies is the role-aware Permissions Policy boundary:
 *
 *        • Performer iframe ─→ allow="camera; microphone; display-capture; autoplay"
 *                              full Jitsi UI (no toolbarButtons override).
 *        • Audience iframe  ─→ allow="autoplay"
 *                              empty toolbar, no shortcuts, disableInitialGUM=true.
 *
 *      The browser enforces the `allow=` boundary at the iframe element
 *      itself, so verifying the attribute on a stubbed iframe is the same
 *      assertion as verifying behaviour against a real Jitsi server — and
 *      it runs deterministically without any network dependency. We
 *      intercept the iframe URL with a 1-line stub HTML so the test does
 *      not depend on a reachable Jitsi instance.
 *
 *   2. WebRTC Yourself preview — the `Yourself.vue` local-camera tile
 *      in the Meeting toolbox. Always-on with Chromium fake-media flags
 *      enabled at the project level (see playwright.config.ts), so this
 *      test verifies the createLocalTracks → attach → first-frame pipeline
 *      against a deterministic synthetic feed. No real webcam is required.
 *
 * A third test, `WebRTC: performer publishes Yourself, audience sees jitsi
 * tile`, is gated on `JITSI_E2E_LIVE=1` and a reachable Jitsi server. It
 * is skipped by default — included so the full end-to-end RTC handshake
 * can be exercised on demand without bloating CI run time or making the
 * suite flaky on infra outages.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

import { findPersona } from "./personas";
import { gql } from "./graphql";
import { LoginPage } from "./pages/LoginPage";
import { LiveStagePage } from "./pages/LiveStagePage";
import { readRuntime } from "./fixtures/runtime";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOT_DIR = path.join(__dirname, "..", "..", "test-results", "streaming");

/**
 * Performer used across the streaming tests. Romeo is one of the personas
 * created in `setup.spec.ts` and granted player permissions on the test
 * stage, so `stage.canPlay` is true and the MeetingObject component takes
 * the performer branch of its role-aware iframe config.
 */
const PERFORMER_USERNAME = "romeo";

/**
 * Decode a Jitsi iframe `src` URL fragment into a key→raw-decoded-value
 * map. Jitsi accepts `#config.<key>=<JSON>` fragment params (and the
 * legacy `#interfaceConfig.<KEY>=<JSON>` family); our component
 * URI-encodes a JSON-stringified value for each. This helper inverts both
 * encodings so assertions can compare against the original literal:
 *
 *     expect(map.get("config.toolbarButtons")).toBe("[]");
 *     expect(map.get("config.disableInitialGUM")).toBe("true");
 */
function parseJitsiFragment(src: string): Map<string, string> {
  const url = new URL(src);
  const hash = url.hash.replace(/^#/, "");
  const map = new Map<string, string>();
  for (const part of hash.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const raw = decodeURIComponent(part.slice(eq + 1));
    map.set(key, raw);
  }
  return map;
}

/**
 * Drive the same `placeObjectOnStage + shapeObject(liveAction:true)`
 * pipeline that real performers trigger when they drag a meeting room
 * out of the toolbox onto the board. PUSH_OBJECT lands it locally;
 * shapeObject's PLACE_OBJECT_ON_STAGE branch broadcasts over MQTT
 * `TOPICS.BOARD`, which every other connected client (including the
 * audience) applies to its own `board.objects`.
 *
 * Returns nothing — the audience side is verified by waiting for a
 * `<iframe class="room">` to appear, which only happens once the audience
 * Pinia store has merged the broadcast into its board.
 */
async function publishMeetingFromPerformer(performerPage: Page, roomName: string): Promise<void> {
  await performerPage.evaluate(
    async ({ name }) => {
      type BoardObject = Record<string, unknown> & { id: string };
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        placeObjectOnStage: (p: unknown) => BoardObject;
        shapeObject: (p: unknown) => unknown | Promise<unknown>;
        board: { objects: BoardObject[] };
        status: string;
      };
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      // Same MQTT-readiness gate placeAvatar() uses in perform.spec.ts.
      // Avoids racing a freshly-mounted page where the connect handshake is
      // still in flight when the test fires its first action.
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (stage.status === "LIVE") break;
        await sleep(250);
      }
      if (stage.status !== "LIVE") {
        throw new Error(
          `streaming: performer MQTT not LIVE (status=${stage.status}); cannot broadcast meeting.`,
        );
      }

      const placed = stage.placeObjectOnStage({
        type: "meeting",
        name,
        description: "",
        w: 320,
        h: 240,
        x: 200,
        y: 150,
      });
      const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
      if (!fromBoard) {
        throw new Error("streaming: placeObjectOnStage did not push to board.objects");
      }
      // shapeObject with liveAction:true && !published emits
      // PLACE_OBJECT_ON_STAGE on TOPICS.BOARD, which the audience MQTT
      // subscriber merges into its local board.
      await Promise.resolve(
        stage.shapeObject({ ...fromBoard, liveAction: true, published: false }),
      );
    },
    { name: roomName },
  );
}

/**
 * Open a fresh anonymous browser context, navigate to the stage as an
 * audience member, wait for MQTT to flip to LIVE (which auto-fires
 * joinStage), and dismiss the LoginPrompt overlay so the board is
 * actually visible. Mirrors the openAudienceSeat helper in
 * perform.spec.ts but lives here so this spec stays self-contained.
 *
 * Returns the audience `Page`; the caller owns its `BrowserContext` and
 * is responsible for closing it.
 */
async function openAudienceSeat(
  context: BrowserContext,
  stageSlug: string,
): Promise<{ page: Page; live: LiveStagePage }> {
  const page = await context.newPage();
  const live = new LiveStagePage(page);
  await live.goto(stageSlug);

  await page.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
    timeout: 30_000,
  });

  // The LoginPrompt modal-background is opaque rgba(10,10,10,0.86); without
  // dismissing it the audience screenshot is just a black rectangle and
  // any `.failed` overlay we want to assert on later is occluded. Same
  // dual-strategy used in perform.spec.ts: Playwright force-click first,
  // JS-level click as a fallback if the animejs rotation lands wrong.
  const loginModal = page.locator(".modal.is-active").first();
  if (await loginModal.isVisible().catch(() => false)) {
    await loginModal
      .locator(".modal-background")
      .first()
      .click({ force: true, timeout: 5_000 })
      .catch(() => {});
    const stillActive = await page
      .locator(".modal.is-active")
      .count()
      .catch(() => 0);
    if (stillActive > 0) {
      await page.evaluate(() => {
        const bg = document.querySelector<HTMLElement>(".modal.is-active .modal-background");
        bg?.click();
      });
    }
    await page
      .waitForFunction(() => document.querySelectorAll(".modal.is-active").length === 0, {
        timeout: 10_000,
      })
      .catch(() => {
        /* if it never clears, the next iframe assertion will surface it */
      });
  }

  return { page, live };
}

test.describe("streaming: performer streams, audience views @full", () => {
  test.describe.configure({ mode: "serial" });
  // The default per-test timeout is 30s. Each test here has to log in,
  // wait for MQTT, dispatch a board action, and wait for it to round-
  // trip to a second client — comfortable in 60s, set 180s for headroom
  // on slower CI runners.
  test.setTimeout(180_000);

  test("embedded MeetingObject: performer-vs-audience iframe contract", async ({ browser }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);

    // Unique per-run room name. Two reasons:
    //   1. The page.route() stub must match a path that no other test or
    //      stray request uses, so we don't intercept anything we didn't
    //      mean to.
    //   2. Reusing the same room across runs would let leftover audience
    //      pages from a previous failed run latch onto the new iframe and
    //      pollute the assertions.
    const roomName = `streaming-test-${runtime.runId}-${Date.now().toString(36)}`;

    /**
     * Stub helper applied to BOTH performer and audience contexts.
     *
     * MeetingObject builds the iframe URL as
     * `https://${useJitsiDomain()}/${roomName}#config...`. We don't need
     * a real Jitsi response for this test: the assertions cover the
     * iframe's `allow=` attribute and src fragment, both of which our
     * component sets BEFORE the iframe ever fetches. A 1-line stub HTML
     * satisfies the load handler (`onLoad` fires → loading overlay
     * clears) without touching real infrastructure.
     *
     * The stub matches `**\/streaming-test-*` rather than just our exact
     * `roomName` because MQTT is configured with `retain: true` (see
     * `src/config.ts` MQTT_CONNECTION). Prior streaming runs leave their
     * `PLACE_OBJECT_ON_STAGE` messages on the broker, and every new
     * audience/performer page receives them on connect — so the
     * `board.objects` array on a freshly-loaded seat may already contain
     * meeting iframes pointing at long-dead room URLs. If we stubbed
     * only our own room, those stale iframes would hit their real
     * (unreachable) URLs, fire `error`, render `.failed`, and pollute
     * the "no .failed overlays" negative assertion below. Stubbing the
     * whole `streaming-test-*` namespace neutralises stale rooms while
     * still satisfying our own iframe load.
     */
    const stubMeetingFor = async (context: BrowserContext) => {
      await context.route("**/streaming-test-*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!DOCTYPE html><html><head><title>${roomName}</title></head><body></body></html>`,
        });
      });
    };

    let performerCtx: BrowserContext | null = null;
    let audienceCtx: BrowserContext | null = null;

    try {
      // --------- 1. Performer logs in and joins the stage ----------
      performerCtx = await browser.newContext();
      await stubMeetingFor(performerCtx);
      const performerPage = await performerCtx.newPage();
      const loginPage = new LoginPage(performerPage);
      await loginPage.login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      // The MeetingObject component branches on `stageStore.canPlay` —
      // assert we actually have player permissions before relying on the
      // performer branch downstream. A regression in canPlay would silently
      // turn this whole test into "audience vs audience".
      const performerCanPlay = await performerPage.evaluate(() =>
        Boolean(window.__UPSTAGE_PINIA__!.stage.canPlay),
      );
      expect(performerCanPlay, "Performer must have player permissions on the test stage").toBe(
        true,
      );

      // --------- 2. Audience joins the stage anonymously ----------
      audienceCtx = await browser.newContext();
      await stubMeetingFor(audienceCtx);
      const audience = await openAudienceSeat(audienceCtx, runtime.stageSlug);

      const audienceCanPlay = await audience.page.evaluate(() =>
        Boolean(window.__UPSTAGE_PINIA__!.stage.canPlay),
      );
      expect(audienceCanPlay, "Audience must NOT have player permissions").toBe(false);

      // --------- 3. Performer dispatches a meeting room ----------
      await publishMeetingFromPerformer(performerPage, roomName);

      // --------- 4. Both sides render an iframe.room for OUR room ----------
      // Scope the iframe locator by room name. MQTT retains
      // `PLACE_OBJECT_ON_STAGE` messages on `TOPICS.BOARD`, so a freshly
      // loaded page may already contain meeting iframes from prior
      // streaming runs. `iframe.room.first()` would race the audience-
      // side MQTT delivery and frequently return one of those stale
      // iframes; using the room name in the selector pins the assertion
      // to the iframe our test just dispatched. Same .frame parent is
      // used to scope the `.failed` negative assertion later, so a
      // stale meeting whose stub-less URL fails to load doesn't false-
      // positive on us.
      const performerFrame = performerPage
        .locator(`.frame:has(iframe.room[src*="${roomName}"])`)
        .first();
      const audienceFrame = audience.page
        .locator(`.frame:has(iframe.room[src*="${roomName}"])`)
        .first();
      await performerFrame.waitFor({ state: "attached", timeout: 30_000 });
      await audienceFrame.waitFor({ state: "attached", timeout: 30_000 });
      const performerIframe = performerFrame.locator("iframe.room");
      const audienceIframe = audienceFrame.locator("iframe.room");

      // --------- 5. Assertions: PERFORMER iframe contract ----------
      const performerSrc = (await performerIframe.getAttribute("src")) ?? "";
      const performerAllow = (await performerIframe.getAttribute("allow")) ?? "";

      expect(performerSrc, "Performer iframe must have a src").not.toBe("");
      expect(performerSrc).toContain(`/${roomName}#`);

      // Full Permissions Policy delegation — performer can use camera, mic,
      // and screen-share inside the iframe. Order is not specified in the
      // attribute, so use `toContain` per token.
      expect(performerAllow).toContain("camera");
      expect(performerAllow).toContain("microphone");
      expect(performerAllow).toContain("display-capture");
      expect(performerAllow).toContain("autoplay");

      const performerFragment = parseJitsiFragment(performerSrc);
      // toolbarButtons is ONLY emitted on the audience branch; its absence
      // here proves the performer branch was taken (rather than e.g. the
      // canPlay computed returning false unexpectedly).
      expect(performerFragment.has("config.toolbarButtons")).toBe(false);
      expect(performerFragment.has("config.disableShortcuts")).toBe(false);
      expect(performerFragment.has("config.readOnlyName")).toBe(false);
      expect(performerFragment.has("interfaceConfig.TOOLBAR_BUTTONS")).toBe(false);
      // disableInitialGUM is always emitted; it's `false` on the performer
      // branch (so Jitsi can prompt for camera/mic on the toolbar) and
      // `true` on the audience branch.
      expect(performerFragment.get("config.disableInitialGUM")).toBe("false");
      // Display name is always present and non-empty (chatname → fallback).
      expect(performerFragment.get("userInfo.displayName")).toBeTruthy();

      // --------- 6. Assertions: AUDIENCE iframe contract (option B) ----------
      const audienceSrc = (await audienceIframe.getAttribute("src")) ?? "";
      const audienceAllow = (await audienceIframe.getAttribute("allow")) ?? "";

      expect(audienceSrc, "Audience iframe must have a src").not.toBe("");
      expect(audienceSrc).toContain(`/${roomName}#`);

      // **The boundary**: audience's iframe must delegate ONLY autoplay.
      // The browser refuses getUserMedia inside the iframe regardless of
      // what UI the iframed Jitsi tries to show, because `camera` and
      // `microphone` are not in this list.
      expect(audienceAllow).toBe("autoplay");
      expect(audienceAllow).not.toContain("camera");
      expect(audienceAllow).not.toContain("microphone");
      expect(audienceAllow).not.toContain("display-capture");

      const audienceFragment = parseJitsiFragment(audienceSrc);
      // No toolbar — both modern (`config.toolbarButtons`) and legacy
      // (`interfaceConfig.TOOLBAR_BUTTONS`) keys, so older Jitsi installs
      // also strip the toolbar.
      expect(audienceFragment.get("config.toolbarButtons")).toBe("[]");
      expect(audienceFragment.get("interfaceConfig.TOOLBAR_BUTTONS")).toBe("[]");
      expect(audienceFragment.get("interfaceConfig.SETTINGS_SECTIONS")).toBe("[]");
      // No initial getUserMedia attempt — audience iframes never prompt.
      expect(audienceFragment.get("config.disableInitialGUM")).toBe("true");
      // No keyboard shortcuts — audience can't trigger toolbar actions
      // via M, V, etc.
      expect(audienceFragment.get("config.disableShortcuts")).toBe("true");
      // Audience can't rename themselves — prevents impersonating a performer
      // in the in-meeting participant list.
      expect(audienceFragment.get("config.readOnlyName")).toBe("true");
      expect(audienceFragment.get("userInfo.displayName")).toBeTruthy();

      // --------- 7. Iframe load succeeded → no .failed overlay ----------
      // The stub responds 200; `onLoad` fires; `loading.value` clears;
      // `failed.value` stays false. Scoped to the .frame for OUR room so
      // a stale meeting from a previous run (whose URL the stub also
      // intercepts, see stubMeetingFor) doesn't influence the result.
      await expect(performerFrame.locator(".failed")).toHaveCount(0, { timeout: 5_000 });
      await expect(audienceFrame.locator(".failed")).toHaveCount(0, { timeout: 5_000 });

      await performerPage.screenshot({
        path: path.join(SCREENSHOT_DIR, "meeting-performer.png"),
        fullPage: true,
      });
      await audience.page.screenshot({
        path: path.join(SCREENSHOT_DIR, "meeting-audience.png"),
        fullPage: true,
      });
    } finally {
      await performerCtx?.close().catch(() => {});
      await audienceCtx?.close().catch(() => {});
    }
  });

  test("embedded MeetingObject: blocked iframe surfaces fallback UI", async ({ browser }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);
    const roomName = `streaming-test-blocked-${runtime.runId}-${Date.now().toString(36)}`;

    let performerCtx: BrowserContext | null = null;
    try {
      performerCtx = await browser.newContext();
      // Simulate Brave Shields / uBlock silently dropping the iframe
      // request. The most common content-blocker behaviour in the wild
      // is NOT to fire the iframe's `error` event — they either return
      // an empty response (which Chromium reports as a successful
      // `load` with no content) or hang the request. To exercise our
      // component's TIMEOUT_MS fallback path (the safety net we
      // specifically added for this case), we hang the request for a
      // hair longer than the component's 15-second loadTimer; the
      // resulting "spinner stuck → failed=true" transition is what we
      // assert on.
      //
      // We do NOT use `route.abort('blockedbyclient')` here: in
      // Chromium that actually fires `load` (with about:blank-like
      // content) on the iframe element, not `error`, so neither
      // onError nor the loadTimer would ever set failed=true.
      //
      // Block ONLY our specific room URL (not the whole streaming-test-*
      // namespace) so any stale meeting iframes from prior runs go
      // through their normal load path without our assertions caring
      // about them.
      const HANG_MS = 17_000; // > component TIMEOUT_MS (15s)
      await performerCtx.route(`**/${roomName}*`, async (route) => {
        await new Promise<void>((resolve) => setTimeout(resolve, HANG_MS));
        // Eventually fulfil so Playwright doesn't leak an open request
        // when the test ends; by this point the component has already
        // surfaced the .failed overlay.
        await route.fulfill({ status: 504, contentType: "text/plain", body: "" }).catch(() => {});
      });

      const performerPage = await performerCtx.newPage();
      const loginPage = new LoginPage(performerPage);
      await loginPage.login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      await publishMeetingFromPerformer(performerPage, roomName);

      // Scope to OUR meeting object's frame so any stale meeting
      // iframes on the board (left over from prior runs by retained
      // MQTT messages) can't satisfy or break this assertion.
      const ourFrame = performerPage.locator(`.frame:has(iframe.room[src*="${roomName}"])`).first();
      await ourFrame.waitFor({ state: "attached", timeout: 30_000 });

      // .failed overlay shows up after the component's 15s loadTimer
      // fires. Allow the full 25s + a small buffer (in case the test
      // host is heavily loaded and the timer's setTimeout slips).
      await expect(ourFrame.locator(".failed")).toBeVisible({ timeout: 25_000 });
      // The fallback exposes the blocked host name in a <code> element
      // so the operator knows what to whitelist.
      await expect(ourFrame.locator(".failed code")).toBeVisible();

      await performerPage.screenshot({
        path: path.join(SCREENSHOT_DIR, "meeting-blocked.png"),
        fullPage: true,
      });
    } finally {
      await performerCtx?.close().catch(() => {});
    }
  });

  test("WebRTC Yourself preview: performer sees fake-camera local feed", async ({ browser }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);

    let performerCtx: BrowserContext | null = null;
    try {
      performerCtx = await browser.newContext();
      const performerPage = await performerCtx.newPage();
      const loginPage = new LoginPage(performerPage);
      await loginPage.login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      // Yourself.vue is mounted lazily inside the Meeting toolbox tab via
      // <component :is="tool" /> in TopBar.vue — it does not exist in the
      // DOM until the user opens that tab. PanelItem renders an <img> with
      // src="/icons/meeting.svg" inside the panel-block; that's the most
      // robust selector for the Meeting tab (no testid yet, and the order
      // of panel items is not stable).
      const meetingTab = performerPage
        .locator('nav#toolbox .panel-block:has(img[src$="meeting.svg"])')
        .first();
      await meetingTab.waitFor({ state: "visible", timeout: 15_000 });
      await meetingTab.click();

      // Yourself.vue's <video> has the new playsinline + muted attributes
      // we added in the cross-browser fix; both are in the template, so
      // they're stable selectors. With Chromium's --use-fake-device-for-
      // media-stream flag (set per-project in playwright.config.ts), the
      // fake camera feed produces decoded frames whose dimensions land in
      // videoWidth/videoHeight — non-zero proves both that
      // createLocalTracks resolved AND that the JitsiTrack.attach() bound
      // the MediaStream to our element.
      const yourselfVideo = performerPage.locator("#topbar video[playsinline][muted]").first();
      try {
        await yourselfVideo.waitFor({ state: "attached", timeout: 30_000 });
      } catch (e) {
        const dump = await performerPage.evaluate(() => {
          const topbar = document.querySelector("#topbar");
          const videos = Array.from(document.querySelectorAll("video")).map((v) => ({
            id: v.id,
            class: v.className,
            playsinline: v.hasAttribute("playsinline"),
            muted: v.hasAttribute("muted"),
            inTopbar: Boolean(topbar?.contains(v)),
            attrs: Array.from(v.attributes).map((a) => `${a.name}="${a.value}"`),
          }));
          return {
            topbarExists: Boolean(topbar),
            topbarHTML: topbar?.innerHTML?.slice(0, 800) ?? null,
            videoCount: videos.length,
            videos,
          };
        });
        console.log("[streaming] yourself-preview DOM dump:", JSON.stringify(dump, null, 2));
        throw e;
      }

      const videoAttrs = await yourselfVideo.evaluate((el) => {
        const v = el as HTMLVideoElement;
        return {
          muted: v.hasAttribute("muted"),
          playsinline: v.hasAttribute("playsinline"),
          disablePiP: v.hasAttribute("disablePictureInPicture") || v.disablePictureInPicture,
        };
      });
      expect(videoAttrs.muted, "Yourself <video> must be muted (no echo)").toBe(true);
      expect(
        videoAttrs.playsinline,
        "Yourself <video> must be playsinline (no iOS fullscreen)",
      ).toBe(true);
      expect(videoAttrs.disablePiP, "Yourself <video> must have PiP disabled").toBe(true);

      // Wait for the fake camera frames to actually be decoded into the
      // element. videoWidth is 0 until the first frame is rendered; once
      // it's > 0 we know the entire createLocalTracks → attach → play
      // pipeline ran without an exception or autoplay block.
      await performerPage.waitForFunction(
        () => {
          const v = document.querySelector(
            "#topbar video[playsinline][muted]",
          ) as HTMLVideoElement | null;
          return Boolean(v && v.videoWidth > 0);
        },
        { timeout: 20_000 },
      );

      // The loading overlay clears on `loadeddata` (or the defensive
      // `play().catch()` fallback we added). Either way, by the time
      // videoWidth > 0 the spinner should be gone — assert so a
      // regression in loading-state plumbing surfaces here.
      await expect(performerPage.locator("#topbar img.overlay")).toHaveCount(0, {
        timeout: 5_000,
      });

      await performerPage.screenshot({
        path: path.join(SCREENSHOT_DIR, "yourself-preview.png"),
        fullPage: true,
      });
    } finally {
      await performerCtx?.close().catch(() => {});
    }
  });

  /**
   * Regression: a stage whose URL slug is literally "demo" must still start
   * the Jitsi conference.
   *
   * `stageStore.url` used to fall back to the string "demo" while the stage
   * model was loading, and useJitsi's one-shot watcher treated that value as
   * the not-loaded placeholder — permanently, for a real stage whose
   * fileLocation IS "demo" (the dev/prod "Demo Stage"). `startConnection()`
   * (and `JitsiMeetJS.init()`) then never ran: no conference, no room, no
   * publish, and every jitsi tile on that stage buffered forever. The
   * placeholder is now the empty string only.
   *
   * Assertion target: the composable's own first-line diagnostics. Both
   * "[diag] useJitsi: starting connection" (endpoint configured) and the
   * "VITE_JITSI_ENDPOINT is unset" warning are emitted only after the
   * placeholder gate has passed — with the old bug neither ever appears on
   * /demo. The local-camera preview is asserted too, proving the stage is
   * fully usable as a publisher surface.
   */
  test("stage slugged 'demo' still starts the jitsi conference", async ({ browser }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);
    await ensureDemoSlugStage(runtime.adminToken, persona.username);

    let performerCtx: BrowserContext | null = null;
    try {
      performerCtx = await browser.newContext();
      const page = await performerCtx.newPage();
      // Attach before navigation — the connection attempt fires as soon as
      // loadStage resolves, well before the board is interactable.
      const consoleLines: string[] = [];
      page.on("console", (msg) => consoleLines.push(msg.text()));

      const loginPage = new LoginPage(page);
      await loginPage.login(persona.username, persona.password);
      const live = new LiveStagePage(page);
      await live.goto("demo");

      await expect
        .poll(
          () =>
            consoleLines.find(
              (l) =>
                l.includes("useJitsi: starting connection") ||
                l.includes("VITE_JITSI_ENDPOINT is unset"),
            ) ?? null,
          {
            timeout: 30_000,
            message:
              'useJitsi never attempted a connection on /demo — the "demo" slug is being ' +
              "treated as the unloaded-stage placeholder again",
          },
        )
        .not.toBeNull();

      // The publisher path must work here too: open the Streams tab and wait
      // for the fake camera to decode into Yourself.vue's <video>.
      const meetingTab = page
        .locator('nav#toolbox .panel-block:has(img[src$="meeting.svg"])')
        .first();
      await meetingTab.waitFor({ state: "visible", timeout: 15_000 });
      await meetingTab.click();
      await page.waitForFunction(
        () => {
          const v = document.querySelector(
            "#topbar video[playsinline][muted]",
          ) as HTMLVideoElement | null;
          return Boolean(v && v.videoWidth > 0);
        },
        { timeout: 30_000 },
      );
    } finally {
      await performerCtx?.close().catch(() => {});
    }
  });

  test("jitsi tile on board persists after closing Streams toolbox panel", async ({ browser }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);
    const streamName = `persist-stream-${runtime.runId}`;

    let performerCtx: BrowserContext | null = null;
    try {
      performerCtx = await browser.newContext();
      const performerPage = await performerCtx.newPage();
      await new LoginPage(performerPage).login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      await performerPage.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
        timeout: 30_000,
      });

      const meetingTab = performerPage
        .locator('nav#toolbox .panel-block:has(img[src$="meeting.svg"])')
        .first();
      await meetingTab.waitFor({ state: "visible", timeout: 15_000 });
      await meetingTab.click();

      const yourselfVideo = performerPage.locator("#topbar video[playsinline][muted]").first();
      await yourselfVideo.waitFor({ state: "attached", timeout: 30_000 });
      await performerPage.waitForFunction(
        () => {
          const v = document.querySelector(
            "#topbar video[playsinline][muted]",
          ) as HTMLVideoElement | null;
          return Boolean(v && v.videoWidth > 0);
        },
        { timeout: 20_000 },
      );

      await performerPage.evaluate(
        async ({ name }) => {
          type BoardObject = Record<string, unknown> & { id: string };
          const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
            placeObjectOnStage: (p: unknown) => BoardObject;
            shapeObject: (p: unknown) => unknown | Promise<unknown>;
            board: { objects: BoardObject[] };
          };
          const placed = stage.placeObjectOnStage({
            type: "jitsi",
            name,
            w: 200,
            h: 150,
            x: 220,
            y: 180,
            liveAction: true,
            published: true,
          });
          const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
          await Promise.resolve(stage.shapeObject({ ...fromBoard, liveAction: true }));
        },
        { name: streamName },
      );

      const boardTile = performerPage.locator(`[data-testid="object-${streamName}"]`);
      await boardTile.waitFor({ state: "visible", timeout: 15_000 });
      const boardVideo = boardTile.locator("video").first();
      await boardVideo.waitFor({ state: "attached", timeout: 30_000 });

      const closePanel = performerPage.locator("#topbar .topbar-close").first();
      await closePanel.waitFor({ state: "visible", timeout: 10_000 });
      await closePanel.click();
      await performerPage.locator("#topbar").waitFor({ state: "hidden", timeout: 10_000 });

      await expect(boardTile).toBeVisible();
      await expect(boardVideo).toBeVisible();
      await expect(boardTile.locator(".loading")).toHaveCount(0, { timeout: 10_000 });

      await performerPage.screenshot({
        path: path.join(SCREENSHOT_DIR, "jitsi-persist-after-close-panel.png"),
        fullPage: true,
      });
    } finally {
      await performerCtx?.close().catch(() => {});
    }
  });

  /**
   * MQTT status flap regression — performer's local WebRTC tracks must
   * NOT be torn down when MQTT briefly goes back to "CONNECTING" (which
   * happens on every mqtt.js auto-reconnect: idle timeouts, network
   * blips, mobile network handoff, etc.).
   *
   * The previous build of `useLocalStreamPublisher` carried:
   *   watch(() => stageStore.status, (status) => {
   *     if (status !== "LIVE") releaseLocalTracks();
   *   });
   * which disposed the published `JitsiTrack`s on every MQTT bounce.
   * Outgoing RTP stopped, JVB forwarded nothing to the audience, the
   * on-stage <Jitsi> tile spun forever, and the top-right refresh
   * button became a no-op (`republishLocalTracks` short-circuits on
   * `tracks.length === 0`). This test would have caught it: the
   * Yourself preview `<video>` would drop `videoWidth` back to 0 the
   * moment we force-set `status = "CONNECTING"`.
   *
   * The fix is to NOT watch MQTT status for WebRTC track lifecycle.
   * Track lifecycle belongs to:
   *   * the component (onUnmounted releases),
   *   * `publishingAllowed()` (canPlay flipping off),
   *   * the board state (own-tile removed).
   * MQTT status is none of the above.
   */
  test("performer tracks survive MQTT status flap (CONNECTING blip)", async ({ browser }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);

    let performerCtx: BrowserContext | null = null;
    try {
      performerCtx = await browser.newContext();
      const performerPage = await performerCtx.newPage();
      await new LoginPage(performerPage).login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      // Open Meeting tab so Yourself.vue mounts and the publisher's
      // `jitsi.localTracks` is bound to a visible <video> element we
      // can poll on for `videoWidth`.
      await performerPage.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
        timeout: 30_000,
      });
      const meetingTab = performerPage
        .locator('nav#toolbox .panel-block:has(img[src$="meeting.svg"])')
        .first();
      await meetingTab.waitFor({ state: "visible", timeout: 15_000 });
      await meetingTab.click();

      const yourselfVideo = performerPage.locator("#topbar video[playsinline][muted]").first();
      await yourselfVideo.waitFor({ state: "attached", timeout: 30_000 });
      // First frame proves createLocalTracks → publisher.syncLocalTracksRef
      // → Yourself.vue attachPreview() ran end-to-end. `videoWidth > 0` is
      // our liveness indicator throughout this test.
      await performerPage.waitForFunction(
        () => {
          const v = document.querySelector(
            "#topbar video[playsinline][muted]",
          ) as HTMLVideoElement | null;
          return Boolean(v && v.videoWidth > 0);
        },
        { timeout: 20_000 },
      );

      // Force the MQTT status flap. We call the mutations directly via
      // the dev hook to avoid actually severing the broker socket — the
      // bug under test is the SPA's reaction to `status` changing, not
      // any broker-side behaviour. The mutations are the same the
      // `client.on("reconnect")` / `client.on("connect")` handlers in
      // stage.ts use.
      await performerPage.evaluate(() => {
        const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
          SET_STATUS: (s: string) => void;
        };
        stage.SET_STATUS("CONNECTING");
      });

      // The bug was synchronous: the watcher fired, releaseLocalTracks()
      // called dispose() on each track, the MediaStream went inert, and
      // the <video> reverted to videoWidth 0 within a frame or two.
      // Give the renderer a couple of animation frames to surface any
      // disposal, then assert the track is still live.
      await performerPage.waitForTimeout(500);

      const stillLiveAfterFlap = await performerPage.evaluate(() => {
        const v = document.querySelector(
          "#topbar video[playsinline][muted]",
        ) as HTMLVideoElement | null;
        // Sample currentTime, sleep a beat, sample again — a disposed
        // track stops decoding so currentTime stops advancing. A still-
        // live track keeps advancing.
        if (!v || v.videoWidth === 0) {
          return Promise.resolve({ alive: false, reason: "no-video", delta: 0 });
        }
        const before = v.currentTime;
        return new Promise<{ alive: boolean; reason: string; delta: number }>((resolve) => {
          setTimeout(() => {
            const after = v.currentTime;
            resolve({
              alive: after > before,
              reason: after > before ? "ok" : "frozen",
              delta: after - before,
            });
          }, 800);
        });
      });
      expect(
        stillLiveAfterFlap.alive,
        `Performer <video> must still be decoding new frames after MQTT CONNECTING flap (reason=${stillLiveAfterFlap.reason}, delta=${stillLiveAfterFlap.delta})`,
      ).toBe(true);

      // Restore status to LIVE — same as the broker's "connect" event
      // does on reconnect. Track lifecycle should be untouched.
      await performerPage.evaluate(() => {
        const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
          SET_STATUS: (s: string) => void;
        };
        stage.SET_STATUS("LIVE");
      });

      // Belt and braces: also poke jitsi.localTracks via the same
      // composable surface a future regression would touch. The
      // publisher exposes `jitsi.localTracks` through Shell.vue's
      // provide. We can't reach the provide map from Playwright, but
      // the <video> already proves the track is bound; this final
      // check just confirms post-LIVE recovery state is stable.
      await performerPage.waitForFunction(
        () => {
          const v = document.querySelector(
            "#topbar video[playsinline][muted]",
          ) as HTMLVideoElement | null;
          return Boolean(v && v.videoWidth > 0 && !v.paused);
        },
        { timeout: 5_000 },
      );

      await performerPage.screenshot({
        path: path.join(SCREENSHOT_DIR, "yourself-after-mqtt-flap.png"),
        fullPage: true,
      });
    } finally {
      await performerCtx?.close().catch(() => {});
    }
  });

  /**
   * Navigate-back regression (store-level) — persisted own-tiles must
   * survive participantId heal without being deleted from the board.
   *
   * Pre-fix race: CONFERENCE_JOINED set `joined=true` before
   * `syncLocalJitsiParticipantId`, so Jitsi.vue's orphan watcher saw
   * a stale participantId, called removeObjectLocally, and the tile
   * vanished before heal could run. `countOwnJitsiOnBoard` also returned
   * 0 (only matched participantId === myUserId), so re-publish never
   * fired.
   */
  test("syncLocalJitsiParticipantId heals stale own-tile without deleting it", async ({
    browser,
  }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);
    const streamName = `heal-stream-${runtime.runId}`;

    let performerCtx: BrowserContext | null = null;
    try {
      performerCtx = await browser.newContext();
      const performerPage = await performerCtx.newPage();
      await new LoginPage(performerPage).login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      await performerPage.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
        timeout: 30_000,
      });

      const healed = await performerPage.evaluate(
        async ({ name }) => {
          type BoardObject = Record<string, unknown> & {
            id: string;
            participantId?: string | null;
            hostId?: string | null;
          };
          const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
            placeObjectOnStage: (p: unknown) => BoardObject;
            shapeObject: (p: unknown) => unknown | Promise<unknown>;
            syncLocalJitsiParticipantId: (id: string | null) => void;
            board: { objects: BoardObject[] };
            session: string | null;
          };
          const placed = stage.placeObjectOnStage({
            type: "jitsi",
            name,
            w: 200,
            h: 150,
            x: 220,
            y: 180,
          });
          const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
          await Promise.resolve(stage.shapeObject({ ...fromBoard, liveAction: true }));
          const hostIdBefore = fromBoard?.hostId ?? null;
          // Simulate navigate-back: tile restored from events with an
          // orphaned participantId from a previous conference membership.
          const staleId = "stale-jitsi-participant-id";
          const afterPlace = stage.board.objects.find((o) => o.id === placed.id);
          if (!afterPlace) {
            return { ok: false, reason: "missing-after-place" };
          }
          afterPlace.participantId = staleId;
          // Fresh myUserId after CONFERENCE_JOINED on re-entry.
          const freshId = "fresh-jitsi-participant-id";
          stage.syncLocalJitsiParticipantId(freshId);
          const afterHeal = stage.board.objects.find((o) => o.id === placed.id);
          if (!afterHeal) {
            return { ok: false, reason: "missing-after-heal" };
          }
          return {
            ok:
              afterHeal.participantId === freshId &&
              afterHeal.hostId === hostIdBefore &&
              afterHeal.hostId === stage.session,
            participantId: afterHeal.participantId,
            hostId: afterHeal.hostId,
            session: stage.session,
          };
        },
        { name: streamName },
      );

      expect(healed.ok, JSON.stringify(healed)).toBe(true);
      expect(healed.participantId).toBe("fresh-jitsi-participant-id");
    } finally {
      await performerCtx?.close().catch(() => {});
    }
  });

  /**
   * Audience orphan regression — a jitsi tile received over MQTT with
   * `participantId: null` must NOT be deleted while waiting for a heal
   * MOVE_TO. Pre-fix: Jitsi.vue's orphan watcher removed such tiles
   * after 1.5s even though WebRTC tracks were still arriving.
   */
  test("audience keeps jitsi tile with null participantId until heal arrives", async ({
    browser,
  }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();

    let audienceCtx: BrowserContext | null = null;
    try {
      audienceCtx = await browser.newContext();
      const audience = await openAudienceSeat(audienceCtx, runtime.stageSlug);

      const result = await audience.page.evaluate(async () => {
        type BoardObject = Record<string, unknown> & {
          id: string;
          participantId?: string | null;
        };
        const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
          handleBoardMessage: (p: { message: { type: string; object: BoardObject } }) => void;
          board: { objects: BoardObject[]; tracks: Array<{ getParticipantId?: () => string }> };
          ADD_TRACK: (t: {
            getParticipantId: () => string;
            type: string;
            getId: () => string;
          }) => void;
        };

        const objectId = "orphan-jitsi-tile-test";
        stage.handleBoardMessage({
          message: {
            type: "placeObjectOnStage",
            object: {
              id: objectId,
              type: "jitsi",
              name: "orphan-stream",
              participantId: null,
              w: 200,
              h: 150,
              x: 100,
              y: 100,
            },
          },
        });

        const afterPlace = stage.board.objects.find((o) => o.id === objectId);
        if (!afterPlace) {
          return { ok: false, reason: "missing-after-place" };
        }

        await new Promise<void>((r) => setTimeout(r, 2000));

        const afterWait = stage.board.objects.find((o) => o.id === objectId);
        if (!afterWait) {
          return { ok: false, reason: "deleted-during-wait" };
        }

        const healedId = "healed-audience-participant-id";
        stage.handleBoardMessage({
          message: {
            type: "moveTo",
            object: { ...afterWait, participantId: healedId },
          },
        });

        const afterHeal = stage.board.objects.find((o) => o.id === objectId);
        if (!afterHeal || afterHeal.participantId !== healedId) {
          return { ok: false, reason: "heal-failed", participantId: afterHeal?.participantId };
        }

        const mockTrack = {
          getParticipantId: () => healedId,
          getId: () => "mock-track-id",
          type: "video",
        };
        stage.ADD_TRACK(mockTrack);

        const matchingTracks = stage.board.tracks.filter(
          (t) => t.getParticipantId?.() === afterHeal.participantId,
        );

        return {
          ok: matchingTracks.length === 1,
          matchingTracksLen: matchingTracks.length,
          participantId: afterHeal.participantId,
        };
      });

      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.participantId).toBe("healed-audience-participant-id");
    } finally {
      await audienceCtx?.close().catch(() => {});
    }
  });

  /**
   * Performer defer regression — shapeObject must not MQTT-publish a jitsi
   * tile until participantId is known; syncLocalJitsiParticipantId flushes
   * the pending publish with a valid join key.
   */
  test("shapeObject defers jitsi MQTT until participantId then flushes on sync", async ({
    browser,
  }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);
    const streamName = `defer-publish-${runtime.runId}`;

    let performerCtx: BrowserContext | null = null;
    try {
      performerCtx = await browser.newContext();
      const performerPage = await performerCtx.newPage();
      await new LoginPage(performerPage).login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      await performerPage.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
        timeout: 30_000,
      });

      const result = await performerPage.evaluate(
        async ({ name }) => {
          type BoardObject = Record<string, unknown> & {
            id: string;
            participantId?: string | null;
            published?: boolean;
            liveAction?: boolean;
          };
          const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
            placeObjectOnStage: (p: unknown) => BoardObject;
            shapeObject: (p: unknown) => unknown | Promise<unknown>;
            syncLocalJitsiParticipantId: (id: string | null) => void;
            board: { objects: BoardObject[] };
          };

          stage.syncLocalJitsiParticipantId(null);
          const placed = stage.placeObjectOnStage({
            type: "jitsi",
            name,
            w: 200,
            h: 150,
            x: 220,
            y: 180,
          });
          const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
          if (!fromBoard) {
            return { ok: false, reason: "missing-after-place" };
          }
          fromBoard.participantId = null;

          await Promise.resolve(
            stage.shapeObject({ ...fromBoard, liveAction: true, published: false }),
          );

          const afterShape = stage.board.objects.find((o) => o.id === placed.id);
          if (!afterShape) {
            return { ok: false, reason: "missing-after-shape" };
          }
          const deferredOk =
            afterShape.liveAction === true &&
            (afterShape.published === false || afterShape.published == null) &&
            (afterShape.participantId == null || afterShape.participantId === "");

          await new Promise<void>((r) => setTimeout(r, 2000));

          const afterWait = stage.board.objects.find((o) => o.id === placed.id);
          if (!afterWait) {
            return { ok: false, reason: "deleted-during-wait" };
          }

          const freshId = "fresh-deferred-participant-id";
          stage.syncLocalJitsiParticipantId(freshId);

          const afterHeal = stage.board.objects.find((o) => o.id === placed.id);
          if (!afterHeal) {
            return { ok: false, reason: "missing-after-heal" };
          }

          return {
            ok:
              deferredOk &&
              afterHeal.participantId === freshId &&
              afterHeal.published === true &&
              afterHeal.liveAction === true,
            deferredOk,
            participantId: afterHeal.participantId,
            published: afterHeal.published,
          };
        },
        { name: streamName },
      );

      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.participantId).toBe("fresh-deferred-participant-id");
      expect(result.published).toBe(true);
    } finally {
      await performerCtx?.close().catch(() => {});
    }
  });

  /**
   * Delete regression — removing a published-but-paused jitsi tile
   * (red bulb: published:true, liveAction:false) must MQTT-broadcast
   * DESTROY so the audience drops the tile too.
   *
   * Pre-fix: deleteObject only published when liveAction was true, so
   * X-ing a paused stream cleared it locally but left the audience
   * staring at a stale frozen tile.
   */
  test("paused-bulb jitsi delete removes tile on audience via MQTT", async ({ browser }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);
    const streamName = `paused-delete-${runtime.runId}`;

    let performerCtx: BrowserContext | null = null;
    let audienceCtx: BrowserContext | null = null;
    try {
      performerCtx = await browser.newContext();
      const performerPage = await performerCtx.newPage();
      await new LoginPage(performerPage).login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      audienceCtx = await browser.newContext();
      const audience = await openAudienceSeat(audienceCtx, runtime.stageSlug);

      await performerPage.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
        timeout: 30_000,
      });

      await performerPage.evaluate(
        async ({ name }) => {
          type BoardObject = Record<string, unknown> & { id: string };
          const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
            placeObjectOnStage: (p: unknown) => BoardObject;
            shapeObject: (p: unknown) => unknown | Promise<unknown>;
            deleteObject: (p: unknown) => unknown | Promise<unknown>;
            board: { objects: BoardObject[] };
          };
          const placed = stage.placeObjectOnStage({
            type: "jitsi",
            name,
            w: 200,
            h: 150,
            x: 220,
            y: 180,
          });
          const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
          await Promise.resolve(stage.shapeObject({ ...fromBoard, liveAction: true }));
          // Pause broadcast (red bulb).
          await Promise.resolve(
            stage.shapeObject({ ...fromBoard, liveAction: false, published: true }),
          );
          const paused = stage.board.objects.find((o) => o.id === placed.id);
          await Promise.resolve(stage.deleteObject({ ...paused }));
        },
        { name: streamName },
      );

      await performerPage.waitForFunction(
        (name) =>
          !window.__UPSTAGE_PINIA__!.stage.board.objects.some(
            (o: { name?: string; type?: string }) => o.type === "jitsi" && o.name === name,
          ),
        streamName,
        { timeout: 15_000 },
      );

      await audience.page.waitForFunction(
        (name) =>
          !window.__UPSTAGE_PINIA__!.stage.board.objects.some(
            (o: { name?: string; type?: string }) => o.type === "jitsi" && o.name === name,
          ),
        streamName,
        { timeout: 15_000 },
      );
    } finally {
      await performerCtx?.close().catch(() => {});
      await audienceCtx?.close().catch(() => {});
    }
  });

  /**
   * Refresh-stream regression — triggerReloadStreams must bump the
   * reloadStreams tick while an own jitsi tile is on the board so
   * localStreamPublisher.republishLocalTracks and Jitsi.vue loadTrack
   * have a signal to re-attach.
   */
  test("triggerReloadStreams bumps reload tick with jitsi tile on board", async ({ browser }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);
    const streamName = `reload-tick-${runtime.runId}`;

    let performerCtx: BrowserContext | null = null;
    try {
      performerCtx = await browser.newContext();
      const performerPage = await performerCtx.newPage();
      await new LoginPage(performerPage).login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      await performerPage.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
        timeout: 30_000,
      });

      const result = await performerPage.evaluate(
        async ({ name }) => {
          type BoardObject = Record<string, unknown> & { id: string };
          const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
            placeObjectOnStage: (p: unknown) => BoardObject;
            shapeObject: (p: unknown) => unknown | Promise<unknown>;
            triggerReloadStreams: () => void;
            board: { objects: BoardObject[] };
            reloadStreams: Date | null;
          };
          const before = stage.reloadStreams;
          stage.placeObjectOnStage({
            type: "jitsi",
            name,
            w: 200,
            h: 150,
            x: 220,
            y: 180,
            liveAction: true,
            published: true,
          });
          stage.triggerReloadStreams();
          const after = stage.reloadStreams;
          const hasTile = stage.board.objects.some(
            (o) => o.type === "jitsi" && (o as { name?: string }).name === name,
          );
          return {
            hasTile,
            tickChanged: after != null && after !== before,
            afterMs: after instanceof Date ? after.getTime() : null,
          };
        },
        { name: streamName },
      );

      expect(result.hasTile).toBe(true);
      expect(result.tickChanged).toBe(true);
      expect(result.afterMs).toBeGreaterThan(0);
    } finally {
      await performerCtx?.close().catch(() => {});
    }
  });

  /**
   * Live RTMP feed tile controls — the tile follows jitsi-window
   * semantics, not the VoD video contract:
   *
   *   • reduced context menu: Volume only — no Play/Pause, Restart, Loop
   *     (a live feed has no timeline; playback starts on connect)
   *   • jitsi-style fit: `object-fit: cover` by default — the picture is
   *     cropped by the freely-resizable frame (stream tiles are
   *     keepRatio-exempt); stretching (fill) is a menu opt-in
   *   • frame-shape row: the shared Shape swatches in the context menu
   *     clip the tile wrapper (border-radius / %-clip-path)
   *   • the Refresh-streams button appears for an RTMP tile (previously
   *     jitsi-only) and its force-reload signal makes LiveStreamPlayer
   *     reconnect immediately instead of waiting out the 5s retry timer.
   *
   * The feed itself is never live: every MediaMTX request (WHEP + HLS,
   * raw and -opus mirror keys) is intercepted with a 404, which drives
   * the player's offline retry loop deterministically.
   */
  test("RTMP tile: reduced menu, shapes, free resize, refresh reconnects", async ({ browser }) => {
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);
    const tileName = `rtmp-tile-${runtime.runId}`;
    const streamKey = `e2e-rtmp-${runtime.runId}`;

    let performerCtx: BrowserContext | null = null;
    try {
      performerCtx = await browser.newContext();
      const page = await performerCtx.newPage();

      // Count connect attempts (each connect() bursts 1-3 requests:
      // -opus WHEP, raw WHEP, HLS manifest — all match this pattern).
      let feedRequests = 0;
      await page.route(`**/live/${streamKey}*/**`, async (route) => {
        feedRequests += 1;
        await route.fulfill({ status: 404, body: "" });
      });

      await new LoginPage(page).login(persona.username, persona.password);
      await new LiveStagePage(page).goto(runtime.stageSlug);
      await page.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
        timeout: 30_000,
      });

      // Place the RTMP tile store-side (placeObjectOnStage is local-only —
      // nothing is broadcast, so the shared test stage stays clean).
      const objectId = await page.evaluate(
        ({ name, key }) => {
          const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
            placeObjectOnStage: (p: unknown) => { id: string };
          };
          const placed = stage.placeObjectOnStage({
            type: "video",
            isRTMP: true,
            name,
            fileLocation: key,
            w: 200,
            h: 150,
            x: 240,
            y: 200,
            liveAction: true,
            published: true,
          });
          return placed.id;
        },
        { name: tileName, key: streamKey },
      );

      // Refresh-streams button shows for an RTMP-only stream set.
      const refreshButton = page
        .locator("#reload-stream button")
        .filter({ has: page.locator("i.fa-sync") });
      await expect(refreshButton).toBeVisible({ timeout: 10_000 });

      // LiveStreamPlayer crops the picture by default (cover; stretch is
      // an explicit Stretch/Crop menu choice).
      const video = page.locator(`[id="video${objectId}"]`);
      await expect(video).toBeAttached({ timeout: 10_000 });
      expect(await video.evaluate((el) => getComputedStyle(el).objectFit)).toBe("cover");

      // Context menu: the standardised stream menu (shared with jitsi
      // tiles) — Mute locally + Volume present; Play/Pause, Restart, Loop
      // and the exit-animation override absent.
      await page.locator(`[data-testid="object-${tileName}"]`).click({ button: "right" });
      const menu = page.locator(".stream-context-menu");
      await expect(menu).toBeVisible({ timeout: 5_000 });
      await expect(menu.locator('[data-testid="stream-mute-locally"]')).toBeVisible();
      await expect(menu.getByText("Volume setting", { exact: false })).toBeVisible();
      await expect(menu.getByText("Play", { exact: true })).toHaveCount(0);
      await expect(menu.getByText("Pause", { exact: true })).toHaveCount(0);
      await expect(menu.getByText("Restart", { exact: true })).toHaveCount(0);
      await expect(menu.getByText("Exit animation", { exact: true })).toHaveCount(0);
      await expect(menu.locator("i.fa-play, i.fa-pause, i.fa-infinity")).toHaveCount(0);

      // Shape row: all presets offered; picking one clips the tile wrapper
      // (the menu stays open so shapes can be tried in place).
      const tileWrapper = page.locator(`[data-object-id="${objectId}"]`);
      await expect(menu.locator('[data-testid^="shape-"]')).toHaveCount(9);
      await menu.locator('[data-testid="shape-circle"]').click();
      await expect
        .poll(() => tileWrapper.evaluate((el) => getComputedStyle(el).borderRadius), {
          timeout: 5_000,
        })
        .toBe("50%");
      await menu.locator('[data-testid="shape-hexagon"]').click();
      await expect
        .poll(() => tileWrapper.evaluate((el) => getComputedStyle(el).clipPath), {
          timeout: 5_000,
        })
        .toMatch(/^polygon\(/);
      // Close the menu with a click on empty board WELL AWAY from it, so
      // the click can't land on another menu row (e.g. Remove) and act on
      // the tile instead of just dismissing the menu.
      await page.mouse.click(150, 520);
      await expect(menu).toBeHidden({ timeout: 5_000 });
      await expect(page.locator(".modal.is-active")).toHaveCount(0);

      // Free resize: stream frames stretch in any direction (keepRatio is
      // off for RTMP/jitsi tiles). Drag the east handle horizontally and
      // assert only the width grew. Click the tile's lower-right quarter:
      // the right-click above left the OpacitySlider overlay active, and it
      // hugs the tile's top/left edges — a centre click would be intercepted
      // and retried until the test times out. (The point is also inside the
      // hexagon clip applied above, so the wrapper still receives it.)
      const wrapperBox = (await tileWrapper.boundingBox())!;
      await page.locator(`[data-testid="object-${tileName}"]`).click({
        position: { x: wrapperBox.width * 0.75, y: wrapperBox.height * 0.75 },
      });
      // Every board object owns a Moveable instance whose (hidden) control
      // box lives on document.body — scope to the visible one.
      const eastHandle = page.locator(".moveable-control.moveable-e:visible");
      await expect(eastHandle).toBeVisible({ timeout: 5_000 });
      const readSize = () =>
        page.evaluate((id) => {
          const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
            board: { objects: Array<{ id: string; w: number; h: number }> };
          };
          const obj = stage.board.objects.find((o) => o.id === id);
          return obj ? { w: obj.w, h: obj.h } : null;
        }, objectId);
      const sizeBefore = await readSize();
      expect(sizeBefore).not.toBeNull();
      const handleBox = await eastHandle.boundingBox();
      expect(handleBox).not.toBeNull();
      const grabX = handleBox!.x + handleBox!.width / 2;
      const grabY = handleBox!.y + handleBox!.height / 2;
      await page.mouse.move(grabX, grabY);
      await page.mouse.down();
      await page.mouse.move(grabX + 80, grabY, { steps: 8 });
      await page.mouse.up();
      await expect
        .poll(async () => (await readSize())!.w, {
          timeout: 5_000,
          message: "east-handle drag must widen the tile",
        })
        .toBeGreaterThan(sizeBefore!.w);
      const sizeAfter = await readSize();
      // Height untouched by a pure-horizontal drag → no ratio lock.
      expect(Math.abs(sizeAfter!.h - sizeBefore!.h)).toBeLessThan(1);
      // Deselect so the moveable frame can't intercept the refresh click.
      await page.mouse.click(150, 520);

      // Refresh reconnects immediately. Sync to the 5s offline-retry
      // cadence first: wait for a fresh attempt, let its request burst
      // finish, then click — any request inside the next 2.5s window can
      // only come from the force-reload signal.
      await expect.poll(() => feedRequests, { timeout: 15_000 }).toBeGreaterThan(0);
      const settled = feedRequests;
      await expect.poll(() => feedRequests, { timeout: 15_000 }).toBeGreaterThan(settled);
      await page.waitForTimeout(500);
      const beforeClick = feedRequests;
      await refreshButton.click();
      await expect
        .poll(() => feedRequests, { timeout: 2_500, message: "refresh must trigger a reconnect" })
        .toBeGreaterThan(beforeClick);
    } finally {
      await performerCtx?.close().catch(() => {});
    }
  });

  /**
   * Cross-client WebRTC publish — performer drags Yourself onto the
   * board, audience renders a `Jitsi.vue` tile that subscribes to the
   * remote track. This needs:
   *
   *   • a real Jitsi server (XMPP + JVB) reachable at VITE_JITSI_ENDPOINT
   *   • Chromium fake-media flags (already on this project)
   *   • lib-jitsi-meet to negotiate ICE end-to-end with the audience seat
   *
   * Skipped by default — set `JITSI_E2E_LIVE=1` (and ensure
   * VITE_JITSI_ENDPOINT points at a working Jitsi install) to run it.
   * Even with all of that, ICE negotiation on a CI runner behind NAT is
   * notoriously flaky; treat this as an opt-in deep-integration test
   * rather than part of the smoke loop.
   *
   * This is the regression net for the publisher-inject bug:
   * `LocalStreamPublisher` was provided from a leaf sibling component so
   * `Yourself.vue#inject("localStreamPublisher")` resolved to null,
   * `publisher.join()` was a no-op, `room.addTrack()` was never called,
   * and JVB reported `bitrate.upload: 0` for every "publisher".
   * Audience tiles appeared (MQTT delivered the placement) but carried
   * no media — `<video>` stayed at `videoWidth === 0`. Asserting
   * `videoWidth > 0` here is the test that would have caught it.
   */
  test("WebRTC: performer publishes Yourself, audience sees video frames @live", async ({
    browser,
  }) => {
    test.skip(
      process.env.JITSI_E2E_LIVE !== "1",
      "JITSI_E2E_LIVE=1 required (real Jitsi server + JVB reachable)",
    );

    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);
    const streamName = `stream-frames-${runtime.runId}-${Date.now().toString(36)}`;

    let performerCtx: BrowserContext | null = null;
    let audienceCtx: BrowserContext | null = null;
    try {
      performerCtx = await browser.newContext();
      const performerPage = await performerCtx.newPage();
      await new LoginPage(performerPage).login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      audienceCtx = await browser.newContext();
      const audience = await openAudienceSeat(audienceCtx, runtime.stageSlug);

      // Open the Meeting toolbox tab. This mounts Yourself.vue, whose
      // onMounted calls publisher.ensureTracks() — but the publisher
      // also acquires tracks on its own (Shell.vue → useLocalStream-
      // Publisher) regardless of Yourself.vue, so this step is
      // belt-and-braces. With Chromium fake-media flags the camera
      // prompt auto-grants and createLocalTracks resolves to a
      // synthetic feed.
      const meetingTab = performerPage
        .locator('nav#toolbox .panel-block:has(img[src$="meeting.svg"])')
        .first();
      await meetingTab.waitFor({ state: "visible", timeout: 15_000 });
      await meetingTab.click();
      await waitForPerformerJoinedAndTracks(performerPage);

      // Drive the publish: place a jitsi tile on the board and
      // broadcast it. The publisher's board-state watcher picks this
      // up, calls room.addTrack, and tracks start flowing to JVB.
      await placeJitsiTileFromPerformer(performerPage, streamName, {
        x: 250,
        y: 200,
      });

      // Audience receives the placement via MQTT and renders Jitsi.vue.
      const audienceTile = audience.page.locator(`[data-testid="object-${streamName}"]`).first();
      await audienceTile.waitFor({ state: "attached", timeout: 60_000 });
      const audienceVideo = audienceTile.locator("video").first();
      await audienceVideo.waitFor({ state: "attached", timeout: 60_000 });

      // The critical assertion: actual decoded frames reach the
      // audience. `videoWidth` stays at 0 until the first frame is
      // decoded, so a non-zero value proves the entire pipeline
      // worked end-to-end:
      //   performer createLocalTracks
      //     → publisher.publishLocalTracksToRoom
      //     → room.addTrack (the no-op before the fix)
      //     → JVB receives RTP, forwards to audience
      //     → audience TRACK_ADDED → Jitsi.vue#loadTrack → attach
      //     → <video> decodes
      // Pre-fix this assertion fails because JVB never received any
      // RTP at all (`bitrate.upload: 0`).
      await audience.page.waitForFunction(
        (testid) => {
          const tile = document.querySelector(`[data-testid="object-${testid}"]`);
          const v = tile?.querySelector("video") as HTMLVideoElement | null;
          return Boolean(v && v.videoWidth > 0);
        },
        streamName,
        { timeout: 60_000 },
      );

      await audience.page.screenshot({
        path: path.join(SCREENSHOT_DIR, "audience-receives-stream.png"),
        fullPage: true,
      });
    } finally {
      await performerCtx?.close().catch(() => {});
      await audienceCtx?.close().catch(() => {});
    }
  });

  /**
   * Navigate-back regression — the second half of the same bug.
   *
   * Even after the inject is repaired, a performer who navigates away
   * from the live page and back must re-publish the tracks for the
   * persisted on-board jitsi tile, otherwise the audience sees a stale
   * frozen frame (or nothing). Two failure modes are covered:
   *
   *   • `pendingPublish` is set only by `Yourself.vue#join()`, so a
   *     fresh `LocalStreamPublisher` instance on remount sat with
   *     `pendingPublish=false` and never re-published. Fix: the
   *     board-state watcher now triggers publish whenever an own-jitsi
   *     tile exists.
   *
   *   • lib-jitsi-meet assigns a fresh `myUserId` on every
   *     CONFERENCE_JOINED, so the persisted tile's `participantId` is
   *     orphaned after rejoin and `Jitsi.vue#isOwnTile` returns false
   *     for the performer (and remote-track lookups by participantId
   *     also fail on the audience side). Fix: `placeObjectOnStage`
   *     stamps `hostId = session.value` on jitsi tiles, and
   *     `syncLocalJitsiParticipantId` rewrites stale participantIds
   *     where `hostId === session.value`.
   *
   * Same `@live` gating as the publish test — needs the real Jitsi
   * server to verify cross-peer media flow.
   */
  test("WebRTC: persisted jitsi tile re-publishes after performer navigates away/back @live", async ({
    browser,
  }) => {
    test.skip(
      process.env.JITSI_E2E_LIVE !== "1",
      "JITSI_E2E_LIVE=1 required (real Jitsi server + JVB reachable)",
    );

    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);
    const streamName = `stream-navback-${runtime.runId}-${Date.now().toString(36)}`;

    let performerCtx: BrowserContext | null = null;
    let audienceCtx: BrowserContext | null = null;
    try {
      // ---- 1. Performer joins, publishes, audience sees frames ----
      performerCtx = await browser.newContext();
      const performerPage = await performerCtx.newPage();
      await new LoginPage(performerPage).login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      audienceCtx = await browser.newContext();
      const audience = await openAudienceSeat(audienceCtx, runtime.stageSlug);

      const meetingTab = performerPage
        .locator('nav#toolbox .panel-block:has(img[src$="meeting.svg"])')
        .first();
      await meetingTab.waitFor({ state: "visible", timeout: 15_000 });
      await meetingTab.click();
      await waitForPerformerJoinedAndTracks(performerPage);

      await placeJitsiTileFromPerformer(performerPage, streamName, {
        x: 260,
        y: 210,
      });

      // Verify the initial publish works — both performer self-tile
      // AND audience receive frames. If this fails, the navigate-back
      // assertion later would be misleading; we'd be testing recovery
      // of a state we never reached in the first place.
      await waitForAudienceVideoFrames(audience.page, streamName, 60_000);

      // ---- 2. Performer navigates AWAY from the live route ----
      // Going to "/" tears down Layout.vue → Shell.vue → useJitsi()
      // disconnect path and (pre-fix) loses the publisher state.
      // Wait for the live layout to actually unmount before navigating
      // back so we exercise the full teardown/setup cycle.
      await performerPage.goto("/");
      await performerPage.waitForLoadState("domcontentloaded");
      await performerPage.waitForFunction(
        () => document.querySelector('#board, [data-testid="board"]') == null,
        { timeout: 10_000 },
      );

      // ---- 3. Performer navigates BACK to the live stage ----
      // loadStage replays board events and re-populates the persisted
      // jitsi tile. Pre-fix: tile is on the board with a stale
      // participantId, no publish was triggered, no tracks flow.
      // Post-fix: hostId-match heals participantId; board-state
      // watcher triggers re-publish; audience video resumes.
      await performerLive.goto(runtime.stageSlug);
      await performerPage.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
        timeout: 30_000,
      });

      // Confirm the persisted tile is back on the performer's board
      // (sanity — persistence itself is a precondition of this test).
      await performerPage.waitForFunction(
        (name) =>
          Boolean(
            window.__UPSTAGE_PINIA__!.stage.board.objects.find(
              (o: { name?: string; type?: string }) => o.type === "jitsi" && o.name === name,
            ),
          ),
        streamName,
        { timeout: 30_000 },
      );

      await waitForPerformerJoinedAndTracks(performerPage);

      // The audience side never navigated, but the JitsiTracks it
      // held for the performer's previous JID are orphaned by the
      // performer's `leave()` on navigate-away. The fresh re-publish
      // arrives with a NEW track id under the performer's NEW
      // myUserId; the audience tile's `participantId` is healed by
      // the performer's syncLocalJitsiParticipantId broadcast so the
      // tile re-binds to the new tracks and frames resume.
      //
      // We poll with a per-iteration freshness check rather than just
      // `videoWidth > 0`: the OLD <video> element may still report
      // its last frozen frame's dimensions even though no new RTP is
      // arriving. The `currentTime` of an attached MediaStream-backed
      // <video> advances as new frames are decoded, so we sample it
      // and require it to advance over the polling window.
      await waitForAudienceVideoFreshFrames(audience.page, streamName, 90_000);

      await performerPage.screenshot({
        path: path.join(SCREENSHOT_DIR, "performer-after-navback.png"),
        fullPage: true,
      });
      await audience.page.screenshot({
        path: path.join(SCREENSHOT_DIR, "audience-after-performer-navback.png"),
        fullPage: true,
      });
    } finally {
      await performerCtx?.close().catch(() => {});
      await audienceCtx?.close().catch(() => {});
    }
  });

  /**
   * Ghost-tile reconcile contract (computeFinalJitsiObjectsFromEvents).
   * De-dup is by *generation* (`participantId`), NOT by `hostId`:
   * lib-jitsi-meet mints a fresh participantId on every CONFERENCE_JOINED
   * and the publisher re-broadcasts its tiles with the current id, so a
   * tile carrying an OLDER participantId than its host's latest broadcast
   * is a leftover of a previous join — drop it. Tiles sharing the CURRENT
   * participantId are concurrent live streams from one tab and must ALL
   * survive (keying the de-dup on hostId alone collapsed them to one —
   * the "multiple streams" regression fixed in c7c4c9c). Tiles with no
   * host/participant binding are legacy data and are kept; DESTROYed
   * tiles are dropped.
   */
  test("reconcileJitsiBoardFromEvents keeps current-generation streams, drops stale generations and destroyed tiles", async ({
    browser,
  }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();

    let audienceCtx: BrowserContext | null = null;
    try {
      audienceCtx = await browser.newContext();
      const audience = await openAudienceSeat(audienceCtx, runtime.stageSlug);

      const result = await audience.page.evaluate(() => {
        type BoardObject = Record<string, unknown> & {
          id: string;
          type?: string;
          hostId?: string;
        };
        const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
          url: string;
          board: { objects: BoardObject[] };
          PUSH_OBJECT: (p: unknown) => void;
          reconcileJitsiBoardFromEvents: (
            events: Array<{ topic: string; payload: unknown; mqttTimestamp: number }>,
          ) => void;
        };

        const boardTopic = `dev/${stage.url}/board`;
        const hostId = "tab-session-host-a";
        const staleGenPid = "participant-gen-1";
        const currentGenPid = "participant-gen-2";
        const stale = "jitsi-stale-generation";
        const liveA = "jitsi-live-a";
        const liveB = "jitsi-live-b";
        const legacy = "jitsi-legacy-unbound";
        const removed = "jitsi-removed";

        // Simulate a stale local board: the prior-generation tile and the
        // destroyed tile are still present when the archive is replayed.
        stage.PUSH_OBJECT({
          id: stale,
          type: "jitsi",
          hostId,
          participantId: staleGenPid,
          name: "previous join",
          x: 10,
          y: 10,
          w: 100,
          h: 80,
        });
        stage.PUSH_OBJECT({
          id: removed,
          type: "jitsi",
          hostId: "other-tab",
          name: "deleted stream",
          x: 400,
          y: 100,
          w: 100,
          h: 80,
        });

        const events = [
          {
            topic: boardTopic,
            mqttTimestamp: 100,
            payload: {
              type: "placeObjectOnStage",
              object: {
                id: stale,
                type: "jitsi",
                hostId,
                participantId: staleGenPid,
                name: "previous join",
              },
            },
          },
          {
            topic: boardTopic,
            mqttTimestamp: 200,
            payload: {
              type: "placeObjectOnStage",
              object: {
                id: liveA,
                type: "jitsi",
                hostId,
                participantId: currentGenPid,
                name: "live stream a",
              },
            },
          },
          {
            topic: boardTopic,
            mqttTimestamp: 300,
            payload: {
              type: "placeObjectOnStage",
              object: {
                id: liveB,
                type: "jitsi",
                hostId,
                participantId: currentGenPid,
                name: "live stream b",
              },
            },
          },
          {
            topic: boardTopic,
            mqttTimestamp: 350,
            payload: {
              type: "placeObjectOnStage",
              object: { id: legacy, type: "jitsi", name: "legacy unbound" },
            },
          },
          {
            topic: boardTopic,
            mqttTimestamp: 400,
            payload: {
              type: "destroy",
              object: { id: removed, type: "jitsi", hostId: "other-tab" },
            },
          },
        ];

        stage.reconcileJitsiBoardFromEvents(events);

        const ids = stage.board.objects.filter((o) => o.type === "jitsi").map((o) => o.id);
        return {
          ids,
          hasStale: ids.includes(stale),
          hasLiveA: ids.includes(liveA),
          hasLiveB: ids.includes(liveB),
          hasLegacy: ids.includes(legacy),
          hasRemoved: ids.includes(removed),
        };
      });

      expect(result.hasStale, "prior-generation tile must be dropped").toBe(false);
      expect(result.hasLiveA, "current-generation tile must survive").toBe(true);
      expect(
        result.hasLiveB,
        "concurrent same-generation stream must survive (hostId de-dup regression)",
      ).toBe(true);
      expect(result.hasLegacy, "legacy tile without host/participant binding is kept").toBe(true);
      expect(result.hasRemoved, "DESTROYed tile must be dropped").toBe(false);
    } finally {
      await audienceCtx?.close().catch(() => {});
    }
  });

  /**
   * Audience prune regression — `pruneOrphanJitsiTilesFromOldSessions` is
   * performer-only (clears this tab's stale hostId tiles). Pre-fix it ran
   * on every audience `joinStage` / MQTT reconnect and deleted every remote
   * jitsi tile because publisher `hostId` never equals the viewer's tab id.
   */
  test("audience joinStage keeps remote jitsi tiles with foreign hostId", async ({ browser }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();

    let audienceCtx: BrowserContext | null = null;
    try {
      audienceCtx = await browser.newContext();
      const audience = await openAudienceSeat(audienceCtx, runtime.stageSlug);

      const result = await audience.page.evaluate(async () => {
        type BoardObject = Record<string, unknown> & {
          id: string;
          hostId?: string;
          participantId?: string;
        };
        const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
          canPlay: boolean;
          session: string | null;
          handleBoardMessage: (p: { message: { type: string; object: BoardObject } }) => void;
          joinStage: () => Promise<void>;
          board: { objects: BoardObject[] };
        };

        const objectId = "audience-remote-jitsi-prune-test";
        const publisherHostId = "performer-tab-session-not-audience";
        stage.handleBoardMessage({
          message: {
            type: "placeObjectOnStage",
            object: {
              id: objectId,
              type: "jitsi",
              name: "remote-stream",
              hostId: publisherHostId,
              participantId: "remote-jitsi-participant",
              w: 200,
              h: 150,
              x: 120,
              y: 140,
            },
          },
        });

        const beforeJoin = stage.board.objects.find((o) => o.id === objectId);
        if (!beforeJoin) {
          return { ok: false, reason: "missing-after-place" };
        }

        await stage.joinStage();

        const afterJoin = stage.board.objects.find((o) => o.id === objectId);
        return {
          ok: Boolean(afterJoin),
          canPlay: stage.canPlay,
          audienceSession: stage.session,
          hostId: afterJoin?.hostId,
          participantId: afterJoin?.participantId,
        };
      });

      expect(result.canPlay).toBe(false);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(result.hostId).toBe("performer-tab-session-not-audience");
      expect(result.participantId).toBe("remote-jitsi-participant");
    } finally {
      await audienceCtx?.close().catch(() => {});
    }
  });

  test("counter leave refreshes retained player statistics for stage preview", async ({
    browser,
  }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();

    let audienceCtx: BrowserContext | null = null;
    try {
      audienceCtx = await browser.newContext();
      const audience = await openAudienceSeat(audienceCtx, runtime.stageSlug);

      const result = await audience.page.evaluate(async () => {
        const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
          sessions: Array<{ id: string; isPlayer?: boolean; at: number }>;
          UPDATE_SESSIONS_COUNTER: (s: {
            id: string;
            isPlayer?: boolean;
            at: number;
            leaving?: boolean;
          }) => void;
          players: Array<{ id: string }>;
          sendStatistics: () => Promise<void>;
          subscribeSuccess: boolean;
        };

        // Drop live roster from MQTT so counts reflect only the synthetic leave below.
        stage.sessions = [];

        stage.UPDATE_SESSIONS_COUNTER({
          id: "preview-player-a",
          isPlayer: true,
          at: Date.now(),
        });
        stage.UPDATE_SESSIONS_COUNTER({
          id: "preview-player-b",
          isPlayer: true,
          at: Date.now(),
        });
        await stage.sendStatistics();

        stage.UPDATE_SESSIONS_COUNTER({
          id: "preview-player-a",
          leaving: true,
          isPlayer: true,
          at: Date.now(),
        });

        return {
          playerCount: stage.players.length,
          subscribeSuccess: stage.subscribeSuccess,
        };
      });

      expect(result.subscribeSuccess).toBe(true);
      expect(result.playerCount).toBe(1);
    } finally {
      await audienceCtx?.close().catch(() => {});
    }
  });
});

// ============================================================================
// Streaming-specific helpers (used by the @live tests above).
// ============================================================================

/**
 * Wait for the performer to be fully wired into the Jitsi conference
 * with local tracks acquired. The publisher requires three async
 * preconditions before `room.addTrack` is meaningful:
 *
 *   1. CONFERENCE_JOINED has fired (lib-jitsi-meet has a `myUserId`).
 *   2. `createLocalTracks` has resolved (camera/mic granted).
 *   3. `jitsi.localTracks` has been written by the publisher.
 *
 * Polling all three from the performer Pinia store + DOM keeps the
 * subsequent `placeObjectOnStage` from racing the publisher.
 */
async function waitForPerformerJoinedAndTracks(performerPage: Page): Promise<void> {
  await performerPage.waitForFunction(
    () => {
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as { status: string };
      if (stage.status !== "LIVE") return false;
      // Yourself.vue's <video ref="el"> is bound the moment
      // `jitsi.localTracks` is populated by the publisher.
      const v = document.querySelector(
        "#topbar video[playsinline][muted]",
      ) as HTMLVideoElement | null;
      return Boolean(v && v.videoWidth > 0);
    },
    { timeout: 60_000 },
  );
}

/**
 * Place a jitsi-typed tile on the performer's board. Uses the same
 * Pinia store path the real drag-from-Yourself handler triggers.
 * Returns the placed object's `id` for downstream lookups.
 */
async function placeJitsiTileFromPerformer(
  performerPage: Page,
  name: string,
  pos: { x: number; y: number },
): Promise<string> {
  return performerPage.evaluate(
    async ({ name: n, pos: p }) => {
      type BoardObject = Record<string, unknown> & {
        id: string;
        participantId?: string | null;
      };
      const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
        placeObjectOnStage: (p: unknown) => BoardObject;
        shapeObject: (p: unknown) => unknown | Promise<unknown>;
        board: { objects: BoardObject[] };
      };
      const placed = stage.placeObjectOnStage({
        type: "jitsi",
        name: n,
        w: 200,
        h: 150,
        x: p.x,
        y: p.y,
      });
      const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
      if (!fromBoard) {
        throw new Error(`streaming: placeObjectOnStage did not push ${n} to board.objects`);
      }
      await Promise.resolve(
        stage.shapeObject({ ...fromBoard, liveAction: true, published: false }),
      );
      return placed.id;
    },
    { name, pos },
  );
}

/**
 * Audience-side assertion: a <video> for the given stream name
 * eventually reports `videoWidth > 0`, i.e. decoded at least one
 * frame. Pre-fix this never happened because JVB received no RTP.
 */
async function waitForAudienceVideoFrames(
  audiencePage: Page,
  streamName: string,
  timeoutMs: number,
): Promise<void> {
  await audiencePage.waitForFunction(
    (testid) => {
      const tile = document.querySelector(`[data-testid="object-${testid}"]`);
      const v = tile?.querySelector("video") as HTMLVideoElement | null;
      return Boolean(v && v.videoWidth > 0);
    },
    streamName,
    { timeout: timeoutMs },
  );
}

/**
 * Stronger audience-side assertion used after the performer navigates
 * away and back: the <video> must not just have *had* frames at some
 * point but must be receiving NEW frames now. A frozen <video> that
 * stopped decoding keeps its last `videoWidth`, so a static check is
 * not enough — sample `currentTime` and require it to advance.
 */
async function waitForAudienceVideoFreshFrames(
  audiencePage: Page,
  streamName: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const advanced = await audiencePage
      .evaluate(
        async ({ testid, sampleWindowMs }) => {
          const tile = document.querySelector(`[data-testid="object-${testid}"]`);
          const v = tile?.querySelector("video") as HTMLVideoElement | null;
          if (!v || v.videoWidth === 0) return false;
          const t0 = v.currentTime;
          await new Promise((r) => setTimeout(r, sampleWindowMs));
          return v.currentTime > t0;
        },
        { testid: streamName, sampleWindowMs: 1500 },
      )
      .catch(() => false);
    if (advanced) return;
    await audiencePage.waitForTimeout(500);
  }
  throw new Error(
    `[streaming] audience <video> for "${streamName}" did not advance currentTime within ${timeoutMs}ms`,
  );
}

/**
 * Find-or-create a stage whose fileLocation is literally "demo" (idempotent
 * across reruns in one harness DB), set it live, and grant the performer
 * player-edit access so `canPlay` is true and the Streams toolbox mounts.
 * Mirrors the setup.spec.ts flow, minus the UI page objects.
 */
async function ensureDemoSlugStage(adminToken: string, performerUsername: string): Promise<string> {
  const existing = await gql<{ stageList: Array<{ id: string | number }> }>(
    `query DemoStageByLoc($fileLocation: String!) {
      stageList(input: { fileLocation: $fileLocation }) { id }
    }`,
    { fileLocation: "demo" },
    adminToken,
  );
  let stageId =
    existing.data?.stageList?.[0]?.id != null ? String(existing.data.stageList[0].id) : null;
  if (!stageId) {
    const created = await gql<{ createStage: { id: string | number } }>(
      `mutation DemoStageCreate($input: StageInput!) {
        createStage(input: $input) { id }
      }`,
      { input: { name: "Demo (sentinel regression)", fileLocation: "demo", status: "live" } },
      adminToken,
    );
    if (created.errors?.length || created.data?.createStage?.id == null) {
      throw new Error(`[streaming] createStage(demo) failed: ${JSON.stringify(created.errors)}`);
    }
    stageId = String(created.data.createStage.id);
  }

  const users = await gql<{ users: Array<{ id: string; username: string }> }>(
    `query DemoStageUsers { users(active: true) { id username } }`,
    {},
    adminToken,
  );
  const performer = users.data?.users?.find(
    (u) => u.username.toLowerCase() === performerUsername.toLowerCase(),
  );
  if (!performer) {
    throw new Error(`[streaming] performer "${performerUsername}" not found for demo stage`);
  }
  // playerAccess is a JSON string of [playerIds, playerEditIds] — same shape
  // StageManagementPage.grantPlayerAccess writes.
  const updated = await gql<{ updateStage: { id: string } | null }>(
    `mutation DemoStageAccess($input: StageInput!) {
      updateStage(input: $input) { id }
    }`,
    {
      input: {
        id: stageId,
        status: "live",
        playerAccess: JSON.stringify([[], [performer.id]]),
      },
    },
    adminToken,
  );
  if (updated.errors?.length) {
    throw new Error(
      `[streaming] demo stage access grant failed: ${JSON.stringify(updated.errors)}`,
    );
  }
  return stageId;
}
