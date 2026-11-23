// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * AudioPlayer element bookkeeping + undecodable-file detection.
 *
 * Bookkeeping: each track owns exactly one <audio> element, listeners are
 * bound once per element (Vue re-invokes function refs on every patch, and
 * the old index-based `refs` array grew and double-bound on each render),
 * and a track added after the first render drives ITS element and reports
 * ITS index — measured on dev 2026-09-10: the new track's play command went
 * to the first element and its timer updates to a phantom row.
 *
 * Detection: a mislabelled upload (an MP4 container named `.mp3`) loads
 * without any `error` event but ends the instant it is played. The player
 * must report it, stop the track, and NOT restart it for a looping track.
 * A genuine end, an end after seeking near the tail, and short clips keep
 * the existing behaviour.
 */

const { messageError, storeState, looper } = vi.hoisted(() => ({
  messageError: vi.fn(),
  storeState: { store: null as Record<string, unknown> | null },
  // Stand-in for the Web Audio loop engine (jsdom has no AudioContext).
  // Default: nothing decoded, so every pre-existing test exercises the
  // element loop exactly as before.
  looper: {
    ready: new Set<string>(),
    active: new Set<object>(),
    canStart: true,
    positionValue: 0 as number | null,
    onLost: null as ((el: object) => void) | null,
    prepare: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    setRate: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock("./gaplessLoop", () => ({
  createGaplessLooper: (deps: { onLost?: (el: object) => void } = {}) => {
    looper.onLost = deps.onLost ?? null;
    return {
      prepare: looper.prepare,
      isReady: (src: string) => looper.ready.has(src),
      isActive: (el: object) => looper.active.has(el),
      start: (el: object, src: string, opts: unknown) => {
        looper.start(el, src, opts);
        if (!looper.canStart) return false;
        looper.active.add(el);
        return true;
      },
      stop: (el: object) => {
        looper.stop(el);
        looper.active.delete(el);
      },
      position: (el: object) => (looper.active.has(el) ? looper.positionValue : null),
      setVolume: looper.setVolume,
      setRate: looper.setRate,
      dispose: looper.dispose,
    };
  },
}));

vi.mock("ant-design-vue", () => ({ message: { error: messageError } }));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    audios: [
      { name: "Broken", src: "/resources/media/broken.mp3", loop: true, isPlaying: true },
      { name: "Fine", src: "/resources/media/fine.mp3", loop: false, isPlaying: true },
    ],
    replay: { isReplaying: false, speed: 1 },
    masterAudioVolume: 1,
    masterAudioSignal: { volume: 1, duration: 0, seq: 0 },
    // A performing session unless a test says otherwise.
    canPlay: true,
    updateAudioStatus: vi.fn(),
    UPDATE_AUDIO: vi.fn(),
    UPDATE_AUDIO_PLAYER_STATUS: vi.fn(),
  });
  storeState.store = store as unknown as Record<string, unknown>;
  return { useStageStore: () => store };
});

import AudioPlayer, { INSTANT_END_MS, INSTANT_END_MIN_REMAINING_S } from "./AudioPlayer.vue";

type Track = { name: string; src: string; loop: boolean; isPlaying: boolean; [k: string]: unknown };
const store = () => storeState.store as unknown as { audios: Track[] };
const updateAudioStatus = () => storeState.store!.updateAudioStatus as ReturnType<typeof vi.fn>;
const playerStatus = () => storeState.store!.UPDATE_AUDIO_PLAYER_STATUS as ReturnType<typeof vi.fn>;

let now = 10_000;
const setDuration = (el: HTMLMediaElement, duration: number) =>
  Object.defineProperty(el, "duration", { configurable: true, get: () => duration });

beforeEach(() => {
  messageError.mockClear();
  updateAudioStatus().mockClear();
  playerStatus().mockClear();
  store().audios.splice(2);
  Object.assign(store().audios[0], { loop: true, isPlaying: true, changed: false, saken: false });
  Object.assign(store().audios[1], { loop: false, isPlaying: true, changed: false, saken: false });
  storeState.store!.canPlay = true;
  (storeState.store!.UPDATE_AUDIO as ReturnType<typeof vi.fn>).mockClear();
  looper.ready.clear();
  looper.active.clear();
  looper.canStart = true;
  looper.positionValue = 0;
  for (const fn of [looper.prepare, looper.start, looper.stop, looper.setVolume, looper.setRate])
    fn.mockClear();
  now = 10_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  // jsdom has no media pipeline: stub play/pause so handlers can call them.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});
// Every mounted player watches the SAME store tracks; one left over from an
// earlier test would consume the next test's `changed` flag first.
const mounted: { unmount: () => void }[] = [];
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});

const mountPlayer = () => {
  const wrapper = mount(AudioPlayer);
  mounted.push(wrapper);
  const els = () => wrapper.findAll("audio").map((w) => w.element as HTMLMediaElement);
  return { wrapper, els };
};

describe("AudioPlayer element bookkeeping", () => {
  it("binds listeners once per element, even after re-renders", async () => {
    const addSpy = vi.spyOn(HTMLMediaElement.prototype, "addEventListener");
    const { els } = mountPlayer();
    // "ended" registrations per element (spy `this` = the element).
    const endedBindings = (el: HTMLMediaElement) =>
      addSpy.mock.calls.filter((c, i) => c[0] === "ended" && addSpy.mock.instances[i] === el)
        .length;
    const firstEl = els()[0];
    expect(endedBindings(firstEl)).toBe(1);

    // Force re-renders: add a track (v-for re-evaluates) twice.
    store().audios.push({
      name: "Late",
      src: "/resources/media/late.mp3",
      loop: false,
      isPlaying: false,
    });
    await nextTick();
    store().audios.push({
      name: "Later",
      src: "/resources/media/later.mp3",
      loop: false,
      isPlaying: false,
    });
    await nextTick();

    expect(els()).toHaveLength(4);
    expect(els()[0]).toBe(firstEl);
    for (const el of els()) expect(endedBindings(el)).toBe(1);
  });

  it("routes a track added after mount to its own element and index", async () => {
    const { els } = mountPlayer();
    const playSpy = HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
    playSpy.mockClear();

    store().audios.push({
      name: "Late",
      src: "/resources/media/late.mp3",
      loop: false,
      isPlaying: true,
      changed: true,
      saken: true,
      currentTime: 0,
    });
    await nextTick();
    await Promise.resolve(); // setRef's queued handleAudioChange
    const lateEl = els()[2];
    expect(lateEl.getAttribute("src")).toBe("/resources/media/late.mp3");
    // play() ran on the new element, not on the first one.
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect((playSpy.mock.contexts[0] as HTMLMediaElement).getAttribute("src")).toBe(
      "/resources/media/late.mp3",
    );
    expect(store().audios[2].changed).toBe(false);

    setDuration(lateEl, 12);
    lateEl.dispatchEvent(new Event("loadedmetadata"));
    expect(playerStatus()).toHaveBeenLastCalledWith({ index: 2, duration: 12 });
    lateEl.dispatchEvent(new Event("timeupdate"));
    expect(playerStatus()).toHaveBeenLastCalledWith({ index: 2, currentTime: lateEl.currentTime });
  });

  it("a normal end on a non-looping track stops that track only", () => {
    const { els } = mountPlayer();
    const el = els()[1];
    setDuration(el, 5);
    el.play();
    now += 5_000;
    el.dispatchEvent(new Event("ended"));
    expect(updateAudioStatus()).toHaveBeenCalledTimes(1);
    expect(updateAudioStatus()).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Fine", isPlaying: false, currentTime: 0 }),
    );
  });
});

describe("AudioPlayer undecodable-file detection", () => {
  it("reports, stops and does not loop-restart a track that ends the instant it starts", () => {
    const { els } = mountPlayer();
    const el = els()[0];
    setDuration(el, 17.45);
    const playSpy = HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;

    el.play(); // records start at t=10000, currentTime 0
    playSpy.mockClear();
    now += INSTANT_END_MS - 100;
    el.dispatchEvent(new Event("ended"));

    expect(messageError).toHaveBeenCalledTimes(1);
    expect(messageError.mock.calls[0][0]).toMatch(/Could not decode Broken/);
    expect(updateAudioStatus()).toHaveBeenCalledTimes(1);
    expect(updateAudioStatus()).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Broken", isPlaying: false, currentTime: 0 }),
    );
    // Looping track: must NOT be restarted (that was the seek storm).
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("treats an end after real playback as normal (loop restarts, no message)", () => {
    const { els } = mountPlayer();
    const el = els()[0];
    setDuration(el, 17.45);
    const playSpy = HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;

    el.play();
    playSpy.mockClear();
    now += 17_450;
    el.dispatchEvent(new Event("ended"));

    expect(messageError).not.toHaveBeenCalled();
    expect(updateAudioStatus()).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledTimes(1); // loop restart
  });

  it("does not flag an end right after seeking into the last second", () => {
    const { els } = mountPlayer();
    const el = els()[1];
    setDuration(el, 30);
    el.currentTime = 30 - INSTANT_END_MIN_REMAINING_S + 0.2;

    el.play();
    now += 100;
    el.dispatchEvent(new Event("ended"));

    expect(messageError).not.toHaveBeenCalled();
    // Non-looping normal end: the existing stop path runs.
    expect(updateAudioStatus()).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Fine", isPlaying: false, currentTime: 0 }),
    );
  });

  it("does not flag a genuinely short clip", () => {
    const { els } = mountPlayer();
    const el = els()[1];
    setDuration(el, 0.4);

    el.play();
    now += 100;
    el.dispatchEvent(new Event("ended"));

    expect(messageError).not.toHaveBeenCalled();
  });
});

/**
 * Reported 2026-09 alongside the seek bug: "an error message appeared at the
 * end saying it was the wrong format or something, which was weird because
 * the file works". Reproduced in Chromium: Play, then within INSTANT_END_MS a
 * seek to just before the end → the healthy file `ended` moments later and
 * was reported as undecodable, because "how much was left" was still
 * measured from where Play began.
 */
describe("AudioPlayer undecodable-file detection — seeks", () => {
  const command = async (track: Track, patch: Record<string, unknown>) => {
    Object.assign(track, patch, { changed: true });
    await nextTick();
  };

  it("does not report a healthy file when a seek to the tail follows Play closely", async () => {
    const { els } = mountPlayer();
    const track = store().audios[1];
    const el = els()[1];
    setDuration(el, 20.05);

    await command(track, { isPlaying: true, currentTime: 5, saken: true }); // Play from 5 s
    now += 250;
    await command(track, { isPlaying: true, currentTime: 20, saken: true }); // seek to 20 s
    now += 150; // 50 ms of audio later…
    el.dispatchEvent(new Event("ended"));

    expect(messageError).not.toHaveBeenCalled();
    expect(updateAudioStatus()).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Fine", isPlaying: false, currentTime: 0 }),
    );
  });

  it("still reports a file that ends instantly after a Play that carried a seek", async () => {
    const { els } = mountPlayer();
    const track = store().audios[1];
    const el = els()[1];
    setDuration(el, 17.45);

    await command(track, { isPlaying: true, currentTime: 3, saken: true });
    now += 80;
    el.dispatchEvent(new Event("ended"));

    expect(messageError).toHaveBeenCalledTimes(1);
    expect(messageError.mock.calls[0][0]).toMatch(/Could not decode Fine/);
  });
});

/**
 * Gapless looping: the Web Audio voice carries the sound of a looping track
 * while the (muted) element keeps being the transport and clock.
 */
describe("AudioPlayer gapless loop hand-over", () => {
  const SRC = "/resources/media/broken.mp3"; // track 0 is the looping one
  const command = async (patch: Record<string, unknown>) => {
    Object.assign(store().audios[0], patch, { changed: true });
    await nextTick();
  };

  it("asks for the decode once the duration of a looping track is known", () => {
    const { els } = mountPlayer();
    setDuration(els()[0], 12);
    els()[0].dispatchEvent(new Event("loadedmetadata"));
    expect(looper.prepare).toHaveBeenCalledWith(SRC, 12);
    // …but not for a track that does not loop.
    setDuration(els()[1], 12);
    els()[1].dispatchEvent(new Event("loadedmetadata"));
    expect(looper.prepare).toHaveBeenCalledTimes(1);
  });

  it("keeps today's element loop while no decoded buffer is available", async () => {
    const { els } = mountPlayer();
    const el = els()[0];
    setDuration(el, 12);
    await command({ isPlaying: true, currentTime: 0, saken: true });
    expect(looper.start).not.toHaveBeenCalled();
    expect(el.muted).toBe(false);

    const playSpy = HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
    playSpy.mockClear();
    now += 12_000;
    el.currentTime = 7;
    el.dispatchEvent(new Event("ended"));
    expect(el.currentTime).toBe(0);
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(el.muted).toBe(false);
  });

  it("lets the voice take over at Play when the buffer is ready, muting the element", async () => {
    looper.ready.add(SRC);
    const { els } = mountPlayer();
    const el = els()[0];
    setDuration(el, 12);
    el.volume = 0.6;
    await command({ isPlaying: true, currentTime: 4, saken: true });

    expect(looper.start).toHaveBeenCalledTimes(1);
    expect(looper.start).toHaveBeenCalledWith(el, SRC, { offset: 4, volume: 0.6, rate: 1 });
    expect(el.muted).toBe(true);
  });

  it("takes over at the first seam when the decode finished mid-pass", async () => {
    const { els } = mountPlayer();
    const el = els()[0];
    setDuration(el, 12);
    await command({ isPlaying: true, currentTime: 0, saken: true });
    expect(el.muted).toBe(false);

    looper.ready.add(SRC); // decode completes while the first pass plays
    now += 12_000;
    el.dispatchEvent(new Event("ended"));
    expect(looper.start).toHaveBeenCalledWith(el, SRC, expect.objectContaining({ offset: 0 }));
    expect(el.muted).toBe(true);
  });

  it("at later seams leaves the voice alone and re-aligns the element's clock to it", async () => {
    looper.ready.add(SRC);
    const { els } = mountPlayer();
    const el = els()[0];
    setDuration(el, 12);
    await command({ isPlaying: true, currentTime: 0, saken: true });
    looper.start.mockClear();
    const playSpy = HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
    playSpy.mockClear();

    looper.positionValue = 0.04;
    now += 12_000;
    el.dispatchEvent(new Event("ended"));

    expect(looper.start).not.toHaveBeenCalled(); // no seam put into the voice
    expect(looper.stop).not.toHaveBeenCalled();
    expect(el.currentTime).toBeCloseTo(0.04);
    expect(playSpy).toHaveBeenCalledTimes(1); // the muted element keeps time
    expect(messageError).not.toHaveBeenCalled();
  });

  it("does not restart the voice for volume / loop-flag echoes, only for seeks", async () => {
    looper.ready.add(SRC);
    const { els } = mountPlayer();
    setDuration(els()[0], 12);
    await command({ isPlaying: true, currentTime: 0, saken: true });
    looper.start.mockClear();

    await command({ volume: 0.3 });
    expect(looper.start).not.toHaveBeenCalled();

    await command({ currentTime: 8, saken: true });
    expect(looper.start).toHaveBeenCalledTimes(1);
    expect(looper.start.mock.calls[0][2]).toMatchObject({ offset: 8 });
  });

  it("mirrors element volume and rate changes onto the voice", () => {
    const { els } = mountPlayer();
    const el = els()[0];
    el.volume = 0.25;
    el.dispatchEvent(new Event("volumechange"));
    expect(looper.setVolume).toHaveBeenLastCalledWith(el, 0.25);
    el.playbackRate = 2;
    el.dispatchEvent(new Event("ratechange"));
    expect(looper.setRate).toHaveBeenLastCalledWith(el, 2);
  });

  it("pause / stop silences the voice and un-mutes the element", async () => {
    looper.ready.add(SRC);
    const { els } = mountPlayer();
    const el = els()[0];
    setDuration(el, 12);
    await command({ isPlaying: true, currentTime: 0, saken: true });
    expect(el.muted).toBe(true);

    await command({ isPlaying: false, saken: false });
    expect(looper.stop).toHaveBeenCalledWith(el);
    expect(el.muted).toBe(false);
  });

  it("switching loop off mid-play hands the sound back from the voice's position", async () => {
    looper.ready.add(SRC);
    const { els } = mountPlayer();
    const el = els()[0];
    setDuration(el, 12);
    await command({ isPlaying: true, currentTime: 0, saken: true });

    looper.positionValue = 6.5;
    await command({ loop: false, saken: false });
    expect(looper.stop).toHaveBeenCalledWith(el);
    expect(el.muted).toBe(false);
    expect(el.currentTime).toBeCloseTo(6.5);
  });

  it("falls back to the audible element when a restart cannot sound", async () => {
    looper.ready.add(SRC);
    const { els } = mountPlayer();
    const el = els()[0];
    setDuration(el, 12);
    await command({ isPlaying: true, currentTime: 0, saken: true });
    expect(el.muted).toBe(true);

    looper.canStart = false; // e.g. the context got suspended
    await command({ currentTime: 5, saken: true });
    expect(looper.active.has(el)).toBe(false);
    expect(el.muted).toBe(false);
    expect(el.currentTime).toBe(5); // the seek itself still applies
  });

  it("un-mutes the element if the browser cuts the voice off", async () => {
    looper.ready.add(SRC);
    const { els } = mountPlayer();
    const el = els()[0];
    setDuration(el, 12);
    await command({ isPlaying: true, currentTime: 0, saken: true });
    expect(el.muted).toBe(true);
    looper.onLost!(el);
    expect(el.muted).toBe(false);
  });

  it("stops a removed track's voice and disposes the engine on unmount", async () => {
    looper.ready.add("/resources/media/late.mp3");
    const { els, wrapper } = mountPlayer();
    store().audios.push({
      name: "Late",
      src: "/resources/media/late.mp3",
      loop: true,
      isPlaying: true,
      changed: true,
      saken: true,
      currentTime: 0,
    });
    await nextTick();
    await Promise.resolve();
    await nextTick();
    const lateEl = els()[2];
    expect(looper.active.has(lateEl)).toBe(true);

    store().audios.splice(2, 1);
    await nextTick();
    expect(looper.stop).toHaveBeenCalledWith(lateEl);

    wrapper.unmount();
    mounted.length = 0;
    expect(looper.dispose).toHaveBeenCalled();
  });
});

/**
 * This component is mounted for EVERYONE. Rule (2026-09): audience sessions
 * watch, chat and react — they never affect the performance. The automatic
 * stop at the end of a track used to be published by every client, so an
 * audience session whose playback lagged could stop a track the performer
 * had just started again.
 */
/**
 * Levels. Until 2026-11-24 this file mocked the animation library that
 * moved the volume, so NOTHING here could notice that the volume never
 * moved: in a real browser the ramp ran on animation frames, which a tab in
 * the background does not get — there a track's own volume slider did
 * nothing and "Fade out" held the level until the stop cut the track off,
 * while the (instant) master slider worked. These tests use the real ramp
 * code with a `requestAnimationFrame` that never calls back, i.e. a hidden
 * tab: what must hold is the level of the `<audio>` element itself.
 */
describe("AudioPlayer levels — reach the element without animation frames", () => {
  let raf: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    Object.assign(storeState.store!, {
      masterAudioVolume: 1,
      masterAudioSignal: { volume: 1, duration: 0, seq: 0 },
    });
    store().audios.forEach((a) => delete a.volume);
  });
  afterEach(() => {
    // Unmount (top-level afterEach runs later) must find its timers.
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    expect(vi.getTimerCount()).toBe(0);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Object.assign(storeState.store!, {
      masterAudioVolume: 1,
      masterAudioSignal: { volume: 1, duration: 0, seq: 0 },
    });
    store().audios.forEach((a) => delete a.volume);
  });

  /** Let `ms` of wall-clock pass: the ramp reads the clock, timers tick. */
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 20) {
      now += 20;
      vi.advanceTimersByTime(20);
    }
  };
  /** What UPDATE_AUDIO does when a track message comes back from the broker. */
  const echo = async (index: number, update: Record<string, unknown>) => {
    Object.assign(store().audios[index], update, { changed: true });
    await nextTick();
  };
  /** What the store does for a master-volume / fade-out message. */
  const master = async (volume: number, duration: number) => {
    const s = storeState.store as unknown as {
      masterAudioVolume: number;
      masterAudioSignal: { volume: number; duration: number; seq: number };
    };
    s.masterAudioVolume = volume;
    s.masterAudioSignal = { volume, duration, seq: s.masterAudioSignal.seq + 1 };
    await nextTick();
  };

  it("a track's volume slider moves that element's volume (and no other)", async () => {
    const { els } = mountPlayer();
    const [first, second] = els();
    expect(second.volume).toBe(1);
    // The toolbox slider sends the value as a string.
    await echo(1, { volume: "0.4" });
    advance(500);
    expect(second.volume).toBeGreaterThan(0.45);
    expect(second.volume).toBeLessThan(0.95);
    advance(600);
    expect(second.volume).toBeCloseTo(0.4, 5);
    expect(first.volume).toBe(1);

    await echo(1, { volume: "0" });
    advance(1100);
    expect(second.volume).toBe(0);
    await echo(1, { volume: "0.71" });
    advance(1100);
    expect(second.volume).toBeCloseTo(0.71, 5);
    expect(raf).not.toHaveBeenCalled();
  });

  it("the master slider applies at once, scaled by each track's own volume", async () => {
    const { els } = mountPlayer();
    await echo(1, { volume: "0.5" });
    advance(1100);
    await master(0.4, 0);
    expect(els()[0].volume).toBeCloseTo(0.4, 5);
    expect(els()[1].volume).toBeCloseTo(0.2, 5);
    await master(1, 0);
    expect(els()[0].volume).toBe(1);
    expect(els()[1].volume).toBeCloseTo(0.5, 5);
  });

  it("a track volume set while the master is lowered is scaled by the master", async () => {
    const { els } = mountPlayer();
    await master(0.5, 0);
    await echo(0, { volume: "0.8" });
    advance(1100);
    expect(els()[0].volume).toBeCloseTo(0.4, 5);
  });

  it("Fade out passes through the levels in between, then Stop restores each track's level", async () => {
    const { els } = mountPlayer();
    await echo(1, { volume: "0.8" });
    advance(1100);
    const [first, second] = els();

    await master(0, 3000);
    const seen: number[] = [];
    for (let t = 0; t < 3000; t += 250) {
      advance(250);
      seen.push(first.volume);
    }
    // A fade: most samples sit strictly between full and silent, falling.
    expect(seen.filter((v) => v > 0.1 && v < 0.9).length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeLessThan(seen[i - 1] + 1e-9);
    expect(first.volume).toBe(0);
    expect(second.volume).toBe(0);

    // What follows on every client: the per-track stops, then master = 1.
    const pause = HTMLMediaElement.prototype.pause as unknown as ReturnType<typeof vi.fn>;
    pause.mockClear();
    await echo(0, { isPlaying: false, currentTime: 0, saken: true });
    await echo(1, { isPlaying: false, currentTime: 0, saken: true });
    expect(pause).toHaveBeenCalledTimes(2);
    await master(1, 0);
    expect(first.volume).toBe(1);
    expect(second.volume).toBeCloseTo(0.8, 5);
    expect(raf).not.toHaveBeenCalled();
  });

  it("a Stop arriving in the middle of a fade out is not undone by the rest of the fade", async () => {
    const { els } = mountPlayer();
    await master(0, 3000);
    advance(1500);
    expect(els()[0].volume).toBeCloseTo(0.5, 1);
    await master(1, 0);
    expect(els()[0].volume).toBe(1);
    advance(3000);
    expect(els()[0].volume).toBe(1);
  });

  it("a looping voice is given the level the ramp arrives at (it mirrors the element)", async () => {
    const { els } = mountPlayer();
    const [first] = els();
    await echo(0, { volume: "0.3" });
    advance(1100);
    looper.setVolume.mockClear();
    first.dispatchEvent(new Event("volumechange"));
    expect(looper.setVolume).toHaveBeenCalledWith(first, first.volume);
    expect(first.volume).toBeCloseTo(0.3, 5);
  });

  it("unmounting in the middle of a ramp leaves no timer behind", async () => {
    const { wrapper } = mountPlayer();
    await master(0, 3000);
    advance(500);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    wrapper.unmount();
    mounted.splice(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("AudioPlayer end-of-track stop — who publishes it", () => {
  const localUpdate = () => storeState.store!.UPDATE_AUDIO as ReturnType<typeof vi.fn>;

  it("a non-performing session settles its own copy and publishes nothing", () => {
    storeState.store!.canPlay = false;
    const { els } = mountPlayer();
    const el = els()[1];
    setDuration(el, 5);
    el.play();
    now += 5_000;
    el.dispatchEvent(new Event("ended"));

    expect(updateAudioStatus()).not.toHaveBeenCalled();
    expect(localUpdate()).toHaveBeenCalledTimes(1);
    expect(localUpdate()).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Fine", isPlaying: false, currentTime: 0 }),
    );
  });

  it("nor does it publish when its copy cannot be played or decoded", () => {
    storeState.store!.canPlay = false;
    const { els } = mountPlayer();
    els()[1].dispatchEvent(new Event("error"));
    const broken = els()[0];
    setDuration(broken, 17.45);
    broken.play();
    now += 50;
    broken.dispatchEvent(new Event("ended"));

    expect(updateAudioStatus()).not.toHaveBeenCalled();
    expect(localUpdate()).toHaveBeenCalledTimes(2);
  });

  it("a performer's stop names the run that ended", () => {
    store().audios[1].playId = "run-7";
    const { els } = mountPlayer();
    const el = els()[1];
    setDuration(el, 5);
    el.play();
    now += 5_000;
    el.dispatchEvent(new Event("ended"));

    expect(updateAudioStatus()).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Fine", isPlaying: false, endedPlayId: "run-7" }),
    );
    expect(localUpdate()).not.toHaveBeenCalled();
    delete store().audios[1].playId;
  });
});
