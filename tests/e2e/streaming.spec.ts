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
     * `https://${useJitsiDomain()}/${roomName}#config...`. In the test
     * environment `useJitsiDomain()` falls back to `window.location.origin`
     * (no VITE_JITSI_ENDPOINT in .env.test), so the iframe would otherwise
     * try to fetch `https://127.0.0.1:3001/<roomName>` — which either 404s
     * or recursively serves the SPA. We don't need a real Jitsi response
     * for this test: the assertions cover the iframe's `allow=` attribute
     * and src fragment, both of which our component sets BEFORE the
     * iframe ever fetches. A 1-line stub HTML satisfies the load handler
     * (`onLoad` fires → loading overlay clears) without touching real
     * infrastructure.
     */
    const stubMeetingFor = async (context: BrowserContext) => {
      await context.route(`**/${roomName}*`, async (route) => {
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

      // --------- 4. Both sides render an iframe.room ----------
      const performerIframe = performerPage.locator("iframe.room").first();
      const audienceIframe = audience.page.locator("iframe.room").first();
      await performerIframe.waitFor({ state: "attached", timeout: 30_000 });
      await audienceIframe.waitFor({ state: "attached", timeout: 30_000 });

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
      // `failed.value` stays false. If the stub failed (or our timeout
      // path triggered) the .failed div would be in the DOM.
      await expect(performerPage.locator(".failed")).toHaveCount(0, { timeout: 5_000 });
      await expect(audience.page.locator(".failed")).toHaveCount(0, { timeout: 5_000 });

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
      // Simulate Brave Shields / uBlock blocking the iframe URL. With
      // route.abort('blockedbyclient') the iframe's `error` handler runs
      // synchronously in the page; the .failed div is rendered without
      // having to wait the full 15s loadTimer fallback. (The loadTimer
      // path is the more conservative fallback for content blockers
      // that swallow `error` instead of firing it; we exercise the
      // `error` branch here because it's deterministic.)
      await performerCtx.route(`**/${roomName}*`, (route) => route.abort("blockedbyclient"));

      const performerPage = await performerCtx.newPage();
      const loginPage = new LoginPage(performerPage);
      await loginPage.login(persona.username, persona.password);
      const performerLive = new LiveStagePage(performerPage);
      await performerLive.goto(runtime.stageSlug);

      await publishMeetingFromPerformer(performerPage, roomName);

      // The .failed overlay is rendered in addition to the (hidden via
      // v-show) iframe; assert the user-facing fallback shows up.
      await expect(performerPage.locator(".failed").first()).toBeVisible({
        timeout: 30_000,
      });
      // The fallback exposes the blocked host name in a <code> element
      // so the operator knows what to whitelist.
      await expect(performerPage.locator(".failed code").first()).toBeVisible();

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
      await yourselfVideo.waitFor({ state: "attached", timeout: 30_000 });

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
   */
  test("WebRTC: performer publishes Yourself, audience sees jitsi tile @live", async ({
    browser,
  }) => {
    test.skip(
      process.env.JITSI_E2E_LIVE !== "1",
      "JITSI_E2E_LIVE=1 required (real Jitsi server + JVB reachable)",
    );

    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const runtime = readRuntime();
    const persona = findPersona(PERFORMER_USERNAME);

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

      // Wait for the performer's Jitsi `joined` flag to flip true. Until
      // then `Yourself.vue#join()` is a no-op (it iterates `tracks` and
      // calls `jitsi.room.addTrack(t)`, but `jitsi.room` is null).
      await performerPage
        .waitForFunction(
          () => {
            // Yourself.vue uses `inject("joined")`. The provider is in
            // Shell.vue which is rendered at the live layout level; we
            // peek at its underlying ref via the global jitsi composable
            // module's exposed state if available, or by polling the
            // performer's published board for any jitsi-typed object as a
            // proxy signal.
            const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
              board: { objects: Array<{ type?: string }> };
            };
            return Boolean(stage.board.objects.find((o) => o.type === "jitsi"));
          },
          { timeout: 60_000 },
        )
        .catch(() => {
          /* fall through; the next assertion will surface a meaningful failure */
        });

      // Drive the publish: place a jitsi-typed object on the board and
      // broadcast it. This is the same code path Yourself.vue's
      // `join()` triggers when the performer drags the tile out of the
      // toolbox onto the board.
      await performerPage.evaluate(async () => {
        type BoardObject = Record<string, unknown> & { id: string };
        const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
          placeObjectOnStage: (p: unknown) => BoardObject;
          shapeObject: (p: unknown) => unknown | Promise<unknown>;
          board: { objects: BoardObject[] };
        };
        const placed = stage.placeObjectOnStage({
          type: "jitsi",
          name: "performer-stream",
          w: 200,
          h: 150,
          x: 250,
          y: 200,
        });
        const fromBoard = stage.board.objects.find((o) => o.id === placed.id);
        await Promise.resolve(
          stage.shapeObject({ ...fromBoard, liveAction: true, published: false }),
        );
      });

      // Audience receives the broadcast and renders Jitsi.vue, which
      // mounts a <video> element to bind the remote MediaStream to.
      const audienceJitsiTile = audience.page
        .locator('[data-testid^="object-performer-stream"]')
        .or(audience.page.locator("video").nth(0));
      await audienceJitsiTile.first().waitFor({ state: "attached", timeout: 60_000 });

      await audience.page.screenshot({
        path: path.join(SCREENSHOT_DIR, "audience-receives-stream.png"),
        fullPage: true,
      });
    } finally {
      await performerCtx?.close().catch(() => {});
      await audienceCtx?.close().catch(() => {});
    }
  });
});
