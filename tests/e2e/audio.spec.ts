/**
 * Stage audio in a real browser (@audio).
 *
 * The unit specs for the audio player run in jsdom, where `<audio>` does not
 * play and the fade library is mocked. They cannot see whether a volume
 * change, a fade or a play command actually reaches the element in a real
 * browser — which is what performers reported broken (per-track volume
 * slider without effect, "fade out" cutting off instead of fading). This
 * spec drives the real toolbox controls with the mouse and reads the
 * `<audio>` elements of BOTH seats: the performer's and an audience
 * member's, since the audience hears whatever its own element does.
 *
 * It runs in Chromium, Google Chrome and Firefox (see playwright.config.ts)
 * because the reports were browser specific.
 *
 * What the reports turned out to be (2026-11-24): volume ramps ran on
 * animation frames, which a tab in the background does not get — see "a seat
 * whose tab is in the background…" below and src/components/stage/volumeFade.ts.
 *
 * Running it:
 *   tests/e2e/env/e2e-backend-up.sh && tests/e2e/env/vite-e2e.sh
 *   tests/e2e/env/e2e-archive-up.sh          # optional: enables the reload test
 *   E2E_EVENT_ARCHIVE=1 pnpm exec playwright test --project=audio --project=audio-chrome --project=audio-firefox
 * Firefox refuses to play without an audio output device; on a server
 * without one, point PULSE_SERVER at a PulseAudio daemon with a null sink.
 * E2E_AUDIO_FILE=/path/to/track.mp3 runs the same checks on a given file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { ADMIN } from "./personas";
import { LoginPage } from "./pages/LoginPage";
import { LiveStagePage } from "./pages/LiveStagePage";
import { MediaLibraryPage } from "./pages/MediaLibraryPage";
import { StageManagementPage } from "./pages/StageManagementPage";
import { readRuntime, type RuntimeState } from "./fixtures/runtime";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Seat {
  context: BrowserContext;
  page: Page;
}

type ElState = {
  paused: boolean;
  volume: number;
  muted: boolean;
  currentTime: number;
  readyState: number;
};

const TRACK_SECONDS = 40;

/** A mono 16-bit PCM WAV holding a steady tone — small, and every browser decodes it. */
function writeToneWav(file: string, seconds: number, hz: number): void {
  const rate = 8000;
  const frames = rate * seconds;
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    data.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * hz * i) / rate)), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([header, data]));
}

/** State of the `<audio>` element playing `name`, read from the page. */
const elState = (seat: Seat, name: string): Promise<ElState | null> =>
  seat.page.evaluate((trackName) => {
    const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
      audios: Array<{ name: string; src: string }>;
    };
    const track = stage.audios.find((a) => a.name === trackName);
    if (!track) return null;
    const el = Array.from(document.querySelectorAll("audio")).find(
      (a) => a.getAttribute("src") === track.src,
    );
    if (!el) return null;
    return {
      paused: el.paused,
      volume: el.volume,
      muted: el.muted,
      currentTime: el.currentTime,
      readyState: el.readyState,
    };
  }, name);

const trackState = (seat: Seat, name: string) =>
  seat.page.evaluate((trackName) => {
    const stage = window.__UPSTAGE_PINIA__!.stage as unknown as {
      audios: Array<{ name: string; volume?: number | string; isPlaying?: boolean }>;
      masterAudioVolume: number;
    };
    const track = stage.audios.find((a) => a.name === trackName);
    return {
      volume: track?.volume === undefined ? null : Number(track.volume),
      isPlaying: Boolean(track?.isPlaying),
      master: stage.masterAudioVolume,
    };
  }, name);

/** Sample the element's volume every `everyMs` for `forMs`. */
async function sampleVolume(seat: Seat, name: string, forMs: number, everyMs = 150) {
  const samples: Array<{ t: number; volume: number; paused: boolean }> = [];
  const start = Date.now();
  while (Date.now() - start < forMs) {
    const s = await elState(seat, name);
    if (s) samples.push({ t: Date.now() - start, volume: s.volume, paused: s.paused });
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return samples;
}

/**
 * A looping track is not heard through its `<audio>` element: a Web Audio
 * voice plays it (gaplessLoop.ts) while the element runs on muted. To know
 * what such a track sounds like we listen where the voice is connected to
 * the speakers: every node connected to an AudioContext destination also
 * feeds an analyser, whose signal level is the level actually sent out.
 */
const TAP_WEB_AUDIO = `(() => {
  // Background-tab switch. Playwright keeps every page "visible" (a tab
  // behind another one still gets animation frames), so the hidden state is
  // reproduced by its page-observable contract: no animation frames are
  // delivered, document.hidden / visibilityState say so, and
  // "visibilitychange" fires. Frames requested meanwhile run on return, as
  // in a real browser. Installed before the app loads because libraries
  // keep their own reference to requestAnimationFrame.
  {
    const nativeRaf = window.requestAnimationFrame.bind(window);
    const nativeCancel = window.cancelAnimationFrame.bind(window);
    let hidden = false;
    let nextId = 1e9;
    const held = new Map();
    window.requestAnimationFrame = (cb) => {
      if (!hidden) return nativeRaf(cb);
      held.set(++nextId, cb);
      return nextId;
    };
    window.cancelAnimationFrame = (id) => {
      if (!held.delete(id)) nativeCancel(id);
    };
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    window.__e2eSetTabHidden = (value) => {
      if (hidden === value) return;
      hidden = value;
      document.dispatchEvent(new Event("visibilitychange"));
      if (!hidden) {
        const callbacks = Array.from(held.values());
        held.clear();
        callbacks.forEach((cb) => nativeRaf(cb));
      }
    };
  }
  // A refused play() is otherwise invisible: report it in the page log.
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    const result = play.apply(this, args);
    if (result && result.catch) {
      result.catch((e) =>
        console.error("play() refused: " + (e && e.name) + ": " + (e && e.message) + " [" + this.tagName + " " + String(this.currentSrc).slice(-40) + "]"),
      );
    }
    return result;
  };
  const taps = (window.__e2eAudioTaps = []);
  const contexts = (window.__e2eAudioContexts = []);
  for (const name of ["AudioContext", "webkitAudioContext"]) {
    const Native = window[name];
    if (!Native) continue;
    window[name] = class extends Native {
      constructor(...args) {
        super(...args);
        contexts.push(this);
      }
    };
  }
  window.__e2eAudioContextStates = () => contexts.map((c) => c.state);
  const connect = AudioNode.prototype.connect;
  const sources = (window.__e2eAudioSources = []);
  const rms = (analyser) => {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  };
  // Signal after the gain divided by the signal before it: the gain that is
  // really being applied to the sound, whatever the parameter reads.
  window.__e2eWebAudioEffectiveGain = () => {
    const out = taps.filter((t) => t.connected).reduce((a, t) => a + rms(t.analyser), 0);
    const src = sources.filter((t) => t.connected).reduce((a, t) => a + rms(t.analyser), 0);
    return { out, src, ratio: src > 1e-5 ? out / src : null, voices: taps.filter((t) => t.connected).length };
  };
  AudioNode.prototype.connect = function (target, ...rest) {
    if (this instanceof AudioBufferSourceNode) {
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      connect.call(this, analyser);
      sources.push({ node: this, analyser, connected: true });
    }
    if (target && target === this.context.destination) {
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      connect.call(this, analyser);
      const tap = { node: this, analyser, connected: true };
      taps.push(tap);
    }
    return connect.call(this, target, ...rest);
  };
  const disconnect = AudioNode.prototype.disconnect;
  AudioNode.prototype.disconnect = function (...args) {
    taps.forEach((t) => { if (t.node === this) t.connected = false; });
    sources.forEach((t) => { if (t.node === this) t.connected = false; });
    return disconnect.apply(this, args);
  };
  window.__e2eWebAudioLevel = () => {
    let peak = 0;
    for (const t of taps) {
      if (!t.connected) continue;
      const buf = new Float32Array(t.analyser.fftSize);
      t.analyser.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    }
    return peak;
  };
})();`;

/** Peak signal level (0..1) currently leaving the page through Web Audio. */
const webAudioLevel = (seat: Seat): Promise<number> =>
  seat.page.evaluate(() =>
    (window as unknown as { __e2eWebAudioLevel: () => number }).__e2eWebAudioLevel(),
  );

/** Put a seat's tab in the background / bring it back (see TAP_WEB_AUDIO). */
const setTabHidden = (seat: Seat, hidden: boolean) =>
  seat.page.evaluate(
    (value) =>
      (window as unknown as { __e2eSetTabHidden: (v: boolean) => void }).__e2eSetTabHidden(value),
    hidden,
  );

/**
 * Record every audio command a seat's store applies (with where it came
 * from: live message or the replay of the archive at load), so a failure
 * shows what the track was told and in which order.
 */
const traceAudioCommands = (seat: Seat) =>
  seat.page.evaluate(() => {
    const w = window as unknown as {
      __e2eAudioTrace?: string[];
      __UPSTAGE_PINIA__: {
        stage: {
          $onAction: (
            cb: (ctx: { name: string; args: unknown[] }) => void,
            detached?: boolean,
          ) => void;
        };
      };
    };
    if (w.__e2eAudioTrace) return;
    const trace = (w.__e2eAudioTrace = [] as string[]);
    const t0 = performance.now();
    w.__UPSTAGE_PINIA__.stage.$onAction(({ name, args }) => {
      if (!/AUDIO|audio|Audio/.test(name)) return;
      if (name === "UPDATE_AUDIO_PLAYER_STATUS") return;
      const a = (args[0] ?? {}) as Record<string, unknown>;
      const m = (a.message ?? a) as Record<string, unknown>;
      trace.push(
        `+${Math.round(performance.now() - t0)}ms ${name} ${JSON.stringify({
          name: m.name,
          isPlaying: m.isPlaying,
          volume: m.volume,
          loop: m.loop,
          saken: m.saken,
          currentTime: m.currentTime,
          playId: m.playId,
          endedPlayId: m.endedPlayId,
          duration: m.duration,
        })}`,
      );
    }, true);
  });
const audioTrace = (seat: Seat) =>
  seat.page.evaluate(
    () => (window as unknown as { __e2eAudioTrace?: string[] }).__e2eAudioTrace ?? [],
  );

/** Page errors and warnings of both seats, printed when a test fails. */
const pageLog: string[] = [];
function watchPage(page: Page, who: string): void {
  page.on("pageerror", (e) => pageLog.push(`[${who}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      pageLog.push(`[${who}] ${m.type()}: ${m.text().slice(0, 300)}`);
    }
  });
}

async function openAdmin(browser: Browser, runtime: RuntimeState): Promise<Seat> {
  const context = await browser.newContext();
  await context.addInitScript(TAP_WEB_AUDIO);
  const page = await context.newPage();
  watchPage(page, "performer");
  await new LoginPage(page).login(ADMIN.username, ADMIN.password);
  await new LiveStagePage(page).goto(runtime.stageSlug);
  await page.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
    timeout: 30_000,
  });
  return { context, page };
}

async function openAudience(browser: Browser, runtime: RuntimeState): Promise<Seat> {
  const context = await browser.newContext();
  await context.addInitScript(TAP_WEB_AUDIO);
  const page = await context.newPage();
  watchPage(page, "audience");
  await new LiveStagePage(page).goto(runtime.stageSlug);
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
  // The audience seat has clicked the preloader curtain ("click anywhere to
  // continue"), which is the user gesture its browser needs before sound
  // started by a broker message may play.
  return { context, page };
}

/** The toolbox tile of track `name` (Audio.vue), with the Audio panel open. */
async function audioTile(seat: Seat, name: string) {
  const tile = seat.page.locator("#topbar .audio").filter({ hasText: name }).first();
  if (!(await tile.isVisible().catch(() => false))) {
    await seat.page.locator('a.panel-block:has(img[src*="audio"])').first().click();
  }
  await tile.waitFor({ state: "visible", timeout: 15_000 });
  return tile;
}

/**
 * Press a track's Play button. The tile widens and its buttons shrink and
 * move while the pointer arrives (a 0.25 s hover transition); a click sent
 * during that movement can land beside the button and do nothing. Do what a
 * person does: point at the tile, let it settle, then click.
 */
async function pressPlay(seat: Seat, tile: ReturnType<Page["locator"]>): Promise<void> {
  await tile.hover();
  await seat.page.waitForTimeout(400);
  await tile.locator(".play-button").click();
}

/**
 * Set a range input the way a person does: press on the track at `fraction`
 * of its length and release. The per-track volume slider is drawn rotated,
 * so the point is taken from the element's on-screen box.
 */
async function pressSlider(
  seat: Seat,
  slider: ReturnType<Page["locator"]>,
  fraction: number,
): Promise<void> {
  const box = await slider.boundingBox();
  if (!box) throw new Error("[audio] slider has no box");
  const vertical = box.height > box.width;
  const x = vertical ? box.x + box.width / 2 : box.x + box.width * fraction;
  const y = vertical ? box.y + box.height * fraction : box.y + box.height / 2;
  await seat.page.mouse.move(x, y);
  await seat.page.mouse.down();
  await seat.page.mouse.up();
}

test.describe("@audio stage audio tracks", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(240_000);

  let runtime: RuntimeState;
  let admin: Seat;
  let audience: Seat;
  const trackName = `e2e-tone-${Date.now().toString(36)}`;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(240_000);
    runtime = readRuntime();

    // Author the track: upload through the real dropzone as `admin`, then
    // assign it to the e2e stage next to the media the setup spec put there.
    // E2E_AUDIO_FILE: check a particular file (e.g. the MP3 from a bug
    // report) instead of the generated tone.
    let wav = path.join(__dirname, "..", "test-results", "audio", `${trackName}.wav`);
    if (process.env.E2E_AUDIO_FILE) wav = process.env.E2E_AUDIO_FILE;
    else writeToneWav(wav, TRACK_SECONDS, 220);
    const authorContext = await browser.newContext();
    const authorPage = await authorContext.newPage();
    await new LoginPage(authorPage).login(ADMIN.username, ADMIN.password);
    const library = new MediaLibraryPage(authorPage);
    await library.goto();
    await library.upload({
      filePath: wav,
      name: trackName,
      mediaType: "audio",
      ownerUsername: ADMIN.username,
    });
    const audioId = await authorPage.evaluate(async (name) => {
      const token = JSON.parse(window.localStorage.getItem("upstage-auth") ?? "{}").token;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const resp = await fetch(`${window.location.origin}/api/studio_graphql`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({
            query: `query M($input: MediaTableInput!) { media(input: $input) { edges { id name } } }`,
            variables: { input: { page: 1, limit: 50, name, mediaTypes: ["audio"] } },
          }),
        });
        const json = await resp.json();
        const hit = (json.data?.media?.edges ?? []).find((m: { name: string }) => m.name === name);
        if (hit) return String(hit.id);
        await new Promise((r) => setTimeout(r, 500));
      }
      return null;
    }, trackName);
    expect(audioId, "uploaded audio track should be in the media library").toBeTruthy();
    const existing = [
      ...Object.values(runtime.mediaByPersona),
      ...Object.values(runtime.props),
      ...Object.values(runtime.backdrops),
    ].map((m) => m.id);
    await new StageManagementPage(authorPage).assignMediaIds(runtime.stageId, [
      ...existing,
      audioId as string,
    ]);
    await authorContext.close();

    admin = await openAdmin(browser, runtime);
    audience = await openAudience(browser, runtime);
    for (const seat of [admin, audience]) {
      await expect
        .poll(async () => (await elState(seat, trackName))?.readyState ?? -1, { timeout: 30_000 })
        .toBeGreaterThanOrEqual(1);
    }
    for (const seat of [admin, audience]) await traceAudioCommands(seat);
    // The master level is stage state: with an event archive running, a
    // level left behind by an earlier run is restored on load. Start at full.
    await admin.page.evaluate(() =>
      (
        window.__UPSTAGE_PINIA__!.stage as unknown as { setMasterAudioVolume: (v: number) => void }
      ).setMasterAudioVolume(1),
    );
    for (const seat of [admin, audience]) {
      await expect
        .poll(async () => (await trackState(seat, trackName)).master, { timeout: 10_000 })
        .toBe(1);
    }
  });

  test.afterEach(async () => {
    // Leave every test with visible tabs, whatever happened in it.
    for (const seat of [admin, audience]) {
      if (seat) await setTabHidden(seat, false).catch(() => {});
    }
  });

  // eslint-disable-next-line no-empty-pattern -- Playwright wants a destructured first argument
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      if (pageLog.length) console.log(`[audio] page log:\n${pageLog.join("\n")}`);
      for (const [who, seat] of [
        ["performer", admin],
        ["audience", audience],
      ] as const) {
        const trace = seat ? await audioTrace(seat).catch(() => []) : [];
        console.log(`[audio] ${who} audio commands:\n${trace.slice(-25).join("\n")}`);
      }
    }
    pageLog.length = 0;
  });

  test.afterAll(async () => {
    await admin?.context.close();
    await audience?.context.close();
  });

  test("Play starts the track for the performer and the audience", async () => {
    const tile = await audioTile(admin, trackName);
    await pressPlay(admin, tile);
    await expect
      .poll(async () => (await trackState(admin, trackName)).isPlaying, {
        message: "the Play command came back from the broker",
      })
      .toBe(true);
    for (const seat of [admin, audience]) {
      await expect
        .poll(async () => (await elState(seat, trackName))?.paused, { timeout: 10_000 })
        .toBe(false);
      const before = (await elState(seat, trackName))!.currentTime;
      await expect
        .poll(async () => (await elState(seat, trackName))!.currentTime, { timeout: 10_000 })
        .toBeGreaterThan(before);
      const state = (await elState(seat, trackName))!;
      expect(state.muted, "a non-looping track is heard through its element").toBe(false);
      expect(state.volume).toBeGreaterThan(0.9);
    }
  });

  test("the track's own volume slider changes the level everyone hears", async () => {
    const tile = await audioTile(admin, trackName);
    await tile.hover();
    const slider = tile.locator(".volume input[type=range]");
    await slider.waitFor({ state: "visible" });

    for (const fraction of [0.7, 0.3]) {
      await pressSlider(admin, slider, fraction);
      const wanted = (await trackState(admin, trackName)).volume!;
      expect(wanted, "the press moved the slider off full volume").toBeLessThan(0.95);
      expect(wanted).toBeGreaterThan(0.05);
      for (const seat of [admin, audience]) {
        await expect
          .poll(async () => (await elState(seat, trackName))!.volume, {
            timeout: 8_000,
            message: `element volume follows the track slider (${wanted})`,
          })
          .toBeCloseTo(wanted, 2);
        expect((await elState(seat, trackName))!.paused).toBe(false);
      }
    }
  });

  test("the master volume slider scales the track's own level", async () => {
    const own = (await trackState(admin, trackName)).volume!;
    const slider = admin.page.locator("#topbar .audio-master input[type=range]");
    await pressSlider(admin, slider, 0.5);
    const master = (await trackState(admin, trackName)).master;
    expect(master).toBeGreaterThan(0.3);
    expect(master).toBeLessThan(0.7);
    for (const seat of [admin, audience]) {
      await expect
        .poll(async () => (await elState(seat, trackName))!.volume, { timeout: 8_000 })
        .toBeCloseTo(own * master, 2);
    }
    // Back to full for the fade test (End: the thumb's half width keeps a
    // press on the track's end just short of the maximum in Firefox).
    await pressSlider(admin, slider, 0.9);
    await slider.press("End");
    await expect
      .poll(async () => (await trackState(admin, trackName)).master)
      .toBeGreaterThan(0.97);
  });

  test("Fade out ramps down gradually, then stops the track", async () => {
    const start = (await elState(admin, trackName))!.volume;
    expect(start).toBeGreaterThan(0.2);
    const fadeButton = admin.page.locator("#topbar .audio-master .master-buttons .icon").nth(1);
    // Leave the slider first: its "Master volume" tooltip would cover the button.
    await admin.page.mouse.move(5, 5);
    await admin.page
      .locator(".ant-tooltip:visible")
      .waitFor({ state: "hidden" })
      .catch(() => {});
    await fadeButton.hover();
    const sampling = Promise.all([
      sampleVolume(admin, trackName, 4500),
      sampleVolume(audience, trackName, 4500),
    ]);
    await fadeButton.click({ force: true });
    const [performerSamples, audienceSamples] = await sampling;

    for (const [who, samples] of [
      ["performer", performerSamples],
      ["audience", audienceSamples],
    ] as const) {
      const playing = samples.filter((s) => !s.paused);
      // A fade is audible as intermediate levels: while still playing, the
      // level must pass through the middle of the range, not jump (or stay
      // put until the stop).
      const intermediate = playing.filter((s) => s.volume > start * 0.1 && s.volume < start * 0.9);
      expect(
        intermediate.length,
        `${who}: levels between 10% and 90% seen while fading: ${JSON.stringify(samples)}`,
      ).toBeGreaterThanOrEqual(3);
      // The track keeps playing for most of the 3 s fade rather than being
      // cut off early.
      const lastPlaying = playing.length ? playing[playing.length - 1].t : 0;
      expect(lastPlaying, `${who}: still playing 2 s into the fade`).toBeGreaterThan(2000);
      // It never gets louder during the fade.
      for (let i = 1; i < playing.length; i += 1) {
        expect(playing[i].volume, `${who}: fade is monotonic`).toBeLessThanOrEqual(
          playing[i - 1].volume + 0.02,
        );
      }
      expect(samples[samples.length - 1].paused, `${who}: stopped after the fade`).toBe(true);
    }
    // Master level is back at full for the next cue.
    await expect.poll(async () => (await trackState(admin, trackName)).master).toBe(1);
    await expect
      .poll(async () => (await trackState(audience, trackName)).master, { timeout: 8_000 })
      .toBe(1);
  });

  test("a track played again after a fade out is heard at its own level", async () => {
    const tile = await audioTile(admin, trackName);
    const own = (await trackState(admin, trackName)).volume!;
    await pressPlay(admin, tile);
    for (const seat of [admin, audience]) {
      await expect
        .poll(async () => (await elState(seat, trackName))?.paused, { timeout: 10_000 })
        .toBe(false);
      await expect
        .poll(async () => (await elState(seat, trackName))!.volume, { timeout: 8_000 })
        .toBeCloseTo(own, 2);
    }
    await tile.hover();
    await tile.locator(".buttons .icon").nth(1).click();
    for (const seat of [admin, audience]) {
      await expect
        .poll(async () => (await elState(seat, trackName))?.paused, { timeout: 10_000 })
        .toBe(true);
    }
  });

  // People listen with the stage in a background tab (and performers keep a
  // second browser open on the stage). A hidden tab gets no animation
  // frames, so anything that needs them to move a volume never happens
  // there — while instant changes still do.
  test("a seat whose tab is in the background follows volume changes and the fade out", async () => {
    const tile = await audioTile(admin, trackName);
    await pressPlay(admin, tile);
    for (const seat of [admin, audience]) {
      await expect
        .poll(async () => (await elState(seat, trackName))?.paused, { timeout: 10_000 })
        .toBe(false);
    }
    await setTabHidden(audience, true);

    await tile.hover();
    const slider = tile.locator(".volume input[type=range]");
    for (const fraction of [0.7, 0.3]) {
      await pressSlider(admin, slider, fraction);
      const wanted = (await trackState(admin, trackName)).volume!;
      await expect
        .poll(async () => (await elState(audience, trackName))!.volume, {
          timeout: 8_000,
          message: `background tab: element volume follows the track slider (${wanted})`,
        })
        .toBeCloseTo(wanted, 2);
    }
    const start = (await elState(audience, trackName))!.volume;

    await admin.page.mouse.move(5, 5);
    await admin.page
      .locator(".ant-tooltip:visible")
      .waitFor({ state: "hidden" })
      .catch(() => {});
    const fadeButton = admin.page.locator("#topbar .audio-master .master-buttons .icon").nth(1);
    await fadeButton.hover();
    const sampling = sampleVolume(audience, trackName, 4500);
    await fadeButton.click({ force: true });
    const samples = await sampling;
    const playing = samples.filter((x) => !x.paused);
    const intermediate = playing.filter((x) => x.volume > start * 0.1 && x.volume < start * 0.9);
    expect(
      intermediate.length,
      `background tab: levels between 10% and 90% while fading: ${JSON.stringify(samples)}`,
    ).toBeGreaterThanOrEqual(3);
    expect(samples[samples.length - 1].paused, "background tab: stopped after the fade").toBe(true);
    await setTabHidden(audience, false);
  });

  const loopFlag = (seat: Seat) =>
    seat.page.evaluate(
      (n) =>
        Boolean(
          (
            window.__UPSTAGE_PINIA__!.stage as unknown as {
              audios: Array<{ name: string; loop?: boolean }>;
            }
          ).audios.find((a) => a.name === n)?.loop,
        ),
      trackName,
    );

  /** Play the (looping) track and check slider, master volume and fade out by ear. */
  const checkLoopingTrackControls = async () => {
    const tile = await audioTile(admin, trackName);
    await tile.hover();
    await pressPlay(admin, tile);
    for (const seat of [admin, audience]) {
      await expect
        .poll(async () => (await elState(seat, trackName))?.paused, { timeout: 10_000 })
        .toBe(false);
    }
    await tile.hover();
    const slider = tile.locator(".volume input[type=range]");

    // What a seat hears of the track: the element's level when it is not
    // muted, otherwise the gain of the looping voice connected to the
    // speakers (0 when the element is muted and no voice is connected —
    // i.e. silence).
    const heard = async (seat: Seat) => {
      const el = (await elState(seat, trackName))!;
      if (el.paused) return 0;
      if (!el.muted) return el.volume;
      const eff = await seat.page.evaluate(() =>
        (
          window as unknown as {
            __e2eWebAudioEffectiveGain: () => { ratio: number | null; voices: number };
          }
        ).__e2eWebAudioEffectiveGain(),
      );
      // Muted element: only a voice with signal flowing counts as heard.
      return eff.ratio ?? 0;
    };

    for (const fraction of [0.75, 0.35]) {
      await pressSlider(admin, slider, fraction);
      const wanted = (await trackState(admin, trackName)).volume!;
      expect(wanted).toBeGreaterThan(0.05);
      expect(wanted).toBeLessThan(0.95);
      for (const seat of [admin, audience]) {
        await expect
          .poll(() => heard(seat), {
            timeout: 8_000,
            message: `heard level follows the track slider (${wanted})`,
          })
          .toBeCloseTo(wanted, 1);
      }
    }
    const own = (await trackState(admin, trackName)).volume!;

    const master = admin.page.locator("#topbar .audio-master input[type=range]");
    await pressSlider(admin, master, 0.5);
    const level = (await trackState(admin, trackName)).master;
    for (const seat of [admin, audience]) {
      await expect.poll(() => heard(seat), { timeout: 8_000 }).toBeCloseTo(own * level, 1);
    }
    await pressSlider(admin, master, 0.9);
    await master.press("End");
    for (const seat of [admin, audience]) {
      await expect.poll(() => heard(seat), { timeout: 8_000 }).toBeCloseTo(own, 1);
    }

    // Fade out.
    await admin.page.mouse.move(5, 5);
    await admin.page
      .locator(".ant-tooltip:visible")
      .waitFor({ state: "hidden" })
      .catch(() => {});
    const fadeButton = admin.page.locator("#topbar .audio-master .master-buttons .icon").nth(1);
    await fadeButton.hover();
    const sample = async (seat: Seat) => {
      const out: Array<{ t: number; level: number; paused: boolean }> = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 4500) {
        const level = await heard(seat);
        out.push({ t: Date.now() - t0, level, paused: (await elState(seat, trackName))!.paused });
        await new Promise((r) => setTimeout(r, 150));
      }
      return out;
    };
    const sampling = Promise.all([sample(admin), sample(audience)]);
    await fadeButton.click({ force: true });
    const results = await sampling;
    for (const [i, who] of (["performer", "audience"] as const).entries()) {
      const samples = results[i];
      const playing = samples.filter((x) => !x.paused);
      const intermediate = playing.filter((x) => x.level > own * 0.1 && x.level < own * 0.9);
      expect(
        intermediate.length,
        `${who}: levels between 10% and 90% heard while fading: ${JSON.stringify(samples)}`,
      ).toBeGreaterThanOrEqual(3);
      expect(playing.length ? playing[playing.length - 1].t : 0).toBeGreaterThan(2000);
      expect(samples[samples.length - 1].paused, `${who}: stopped after the fade`).toBe(true);
    }
    // Nothing is left sounding once the track has stopped.
    for (const seat of [admin, audience]) {
      await expect.poll(() => webAudioLevel(seat), { timeout: 5_000 }).toBeLessThan(0.005);
    }
    await expect.poll(async () => (await trackState(admin, trackName)).master).toBe(1);
  };

  test("a looping track: volume slider, master volume and fade out are all heard", async () => {
    const tile = await audioTile(admin, trackName);
    await tile.hover();
    await tile.locator(".buttons .icon").last().click();
    await expect.poll(() => loopFlag(admin)).toBe(true);
    await expect.poll(() => loopFlag(audience), { timeout: 8_000 }).toBe(true);
    await checkLoopingTrackControls();
  });

  // What performers actually do: come back to a stage whose tracks were set
  // to loop in an earlier session. The stage state (loop flag, levels) is
  // then restored from the event archive while the page loads — before the
  // visitor has clicked anything — which is a different start-up order from
  // switching loop on by hand. Needs the e2e event-archive worker
  // (tests/e2e/env/e2e-archive-up.sh); skipped without it.
  test("a looping track restored on reload: controls are still heard", async () => {
    test.skip(!process.env.E2E_EVENT_ARCHIVE, "needs the e2e event-archive worker");
    for (const seat of [admin, audience]) {
      await seat.page.reload();
      await new LiveStagePage(seat.page).goto(runtime.stageSlug);
      await seat.page.waitForFunction(() => window.__UPSTAGE_PINIA__!.stage.status === "LIVE", {
        timeout: 30_000,
      });
      await expect
        .poll(async () => (await elState(seat, trackName))?.readyState ?? -1, { timeout: 30_000 })
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(() => loopFlag(seat), {
          timeout: 15_000,
          message: "loop flag restored from the archive",
        })
        .toBe(true);
    }
    await checkLoopingTrackControls();
  });
});
