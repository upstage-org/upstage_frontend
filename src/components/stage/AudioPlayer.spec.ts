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
vi.mock("animejs", () => ({ animate: vi.fn() }));
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
