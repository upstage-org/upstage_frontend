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

const { messageError, storeState } = vi.hoisted(() => ({
  messageError: vi.fn(),
  storeState: { store: null as Record<string, unknown> | null },
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
    updateAudioStatus: vi.fn(),
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
afterEach(() => {
  vi.restoreAllMocks();
});

const mountPlayer = () => {
  const wrapper = mount(AudioPlayer);
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
