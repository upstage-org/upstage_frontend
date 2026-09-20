// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * Audio toolbox — seeking while a track plays.
 *
 * Reported 2026-09: "if you are playing an audio file & want to skip to
 * another part of the track, the slider jumps back to the point it's playing
 * at." The seek slider's `value` was bound to the player's `currentTime`,
 * which `timeupdate` rewrites ~4x a second, so each re-render reset the
 * thumb under the user's finger. Reproduced in Chromium: a press held
 * ~400 ms produced no `change` event at all; a longer one produced `change`
 * carrying the PLAYING position. These tests replay exactly that sequence:
 * user `input`, then a player time update, then `change`.
 */

const { storeState } = vi.hoisted(() => ({
  storeState: { store: null as Record<string, unknown> | null },
}));

vi.mock("animejs", () => ({ animate: vi.fn() }));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    audios: [
      { name: "Track", src: "/resources/audio/track.mp3", isPlaying: true, loop: false, volume: 1 },
      { name: "Other", src: "/resources/audio/other.mp3", isPlaying: true, loop: false, volume: 1 },
    ],
    audioPlayers: [
      { duration: 60, currentTime: 5 },
      { duration: 90, currentTime: 12 },
    ],
    masterAudioVolume: 1,
    updateAudioStatus: vi.fn(),
    setMasterAudioVolume: vi.fn(),
    stopAllAudio: vi.fn(),
    fadeOutAllAudio: vi.fn(),
  });
  storeState.store = store as unknown as Record<string, unknown>;
  return { useStageStore: () => store };
});

import Audio from "./Audio.vue";

type Player = { duration: number; currentTime: number };
const store = () =>
  storeState.store as unknown as {
    audios: Record<string, unknown>[];
    audioPlayers: Player[];
    updateAudioStatus: ReturnType<typeof vi.fn>;
  };

const mountAudio = () => {
  const wrapper = mount(Audio, {
    global: {
      mocks: { $t: (key: string) => key },
      stubs: { Icon: true, "a-tooltip": { template: "<div><slot /></div>" } },
    },
  });
  const slider = (i = 0) =>
    wrapper.findAll("input.is-primary")[i].element as unknown as HTMLInputElement;
  /** What a user gesture does: the browser sets the value, then fires the event. */
  const user = async (type: "input" | "change", value: number, i = 0) => {
    slider(i).value = String(value);
    slider(i).dispatchEvent(new Event(type, { bubbles: true }));
    await nextTick();
  };
  /** What `timeupdate` does: the player reports a new position. */
  const playerAt = async (currentTime: number, i = 0) => {
    store().audioPlayers[i].currentTime = currentTime;
    await nextTick();
  };
  return { wrapper, slider, user, playerAt };
};

beforeEach(() => {
  vi.useFakeTimers();
  store().updateAudioStatus.mockClear();
  store().audioPlayers[0].currentTime = 5;
  store().audioPlayers[1].currentTime = 12;
  store().audios.forEach((a) => {
    delete a.saken;
    delete a.currentTime;
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Audio toolbox — seek slider", () => {
  it("follows the player's position while nobody is touching it", async () => {
    const { slider, playerAt, wrapper } = mountAudio();
    expect(slider().value).toBe("5");
    await playerAt(6);
    expect(slider().value).toBe("6");
    wrapper.unmount();
  });

  it("keeps the user's value while they hold the thumb and the track keeps playing", async () => {
    const { slider, user, playerAt, wrapper } = mountAudio();
    await user("input", 45);
    await playerAt(5.25);
    await playerAt(5.5);
    // Before the fix the re-render wrote 5.5 back into the input here.
    expect(slider().value).toBe("45");
    wrapper.unmount();
  });

  it("seeks to the user's value even if time updates arrived before release", async () => {
    const { slider, user, playerAt, wrapper } = mountAudio();
    await user("input", 45);
    await playerAt(6.2);
    // Release: `change` with whatever the DOM holds — still the user's value.
    slider().dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();

    expect(store().updateAudioStatus).toHaveBeenCalledTimes(1);
    const sent = store().updateAudioStatus.mock.calls[0][0];
    expect(sent.src).toBe("/resources/audio/track.mp3");
    expect(sent.currentTime).toBe(45);
    expect(sent.saken).toBe(true);
    wrapper.unmount();
  });

  it("commits the dragged value even when the DOM value was clobbered before `change`", async () => {
    const { slider, user, wrapper } = mountAudio();
    await user("input", 45);
    // Worst case seen in the browser: `change` arrives carrying the playing position.
    slider().value = "6";
    slider().dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();
    expect(store().updateAudioStatus.mock.calls[0][0].currentTime).toBe(45);
    wrapper.unmount();
  });

  it("sends a number, not the input's string value", async () => {
    const { user, wrapper } = mountAudio();
    await user("input", 30);
    await user("change", 30);
    expect(store().updateAudioStatus.mock.calls[0][0].currentTime).toStrictEqual(30);
    wrapper.unmount();
  });

  it("holds the thumb on the target until the player catches up, then follows it again", async () => {
    const { slider, user, playerAt, wrapper } = mountAudio();
    await user("input", 45);
    await user("change", 45);
    // The seek is still travelling via the broker: old position keeps arriving.
    await playerAt(6.5);
    expect(slider().value).toBe("45");
    // Player reports the new position → slider is released and tracks it.
    await playerAt(45.1);
    await playerAt(46);
    expect(slider().value).toBe("46");
    wrapper.unmount();
  });

  it("lets go after a timeout if the seek never takes effect", async () => {
    const { slider, user, playerAt, wrapper } = mountAudio();
    await user("input", 45);
    await user("change", 45);
    await playerAt(7);
    expect(slider().value).toBe("45");
    vi.advanceTimersByTime(3000);
    await nextTick();
    expect(slider().value).toBe("7");
    wrapper.unmount();
  });

  it("drops an abandoned press (pointer released where it started: no `change`)", async () => {
    const { wrapper, slider, user, playerAt } = mountAudio();
    await user("input", 45);
    slider().dispatchEvent(new Event("pointerup", { bubbles: true }));
    vi.advanceTimersByTime(0);
    await playerAt(8);
    expect(slider().value).toBe("8");
    expect(store().updateAudioStatus).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("does not drop the scrub when `change` follows the pointer release", async () => {
    const { slider, user, wrapper } = mountAudio();
    await user("input", 45);
    slider().dispatchEvent(new Event("pointerup", { bubbles: true }));
    slider().dispatchEvent(new Event("change", { bubbles: true }));
    vi.advanceTimersByTime(0);
    await nextTick();
    expect(store().updateAudioStatus.mock.calls[0][0].currentTime).toBe(45);
    expect(slider().value).toBe("45");
    wrapper.unmount();
  });

  it("scrubbing one track leaves the other track's slider alone", async () => {
    const { slider, user, playerAt, wrapper } = mountAudio();
    await user("input", 45, 0);
    await playerAt(13, 1);
    expect(slider(0).value).toBe("45");
    expect(slider(1).value).toBe("13");
    wrapper.unmount();
  });

  it("a plain keyboard/click seek (change without a preceding input) still works", async () => {
    const { user, wrapper } = mountAudio();
    await user("change", 20);
    expect(store().updateAudioStatus.mock.calls[0][0].currentTime).toBe(20);
    wrapper.unmount();
  });
});

describe("Audio toolbox — play / pause", () => {
  const press = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  const reset = () => {
    Object.assign(store().audios[0], { isPlaying: false });
    delete store().audios[0].playId;
  };

  it("the number-key shortcut sends the current position, like the button does", async () => {
    reset();
    const { wrapper } = mountAudio();
    store().audioPlayers[0].currentTime = 23.5;
    press("1");
    await nextTick();

    const sent = store().updateAudioStatus.mock.calls[0][0];
    expect(sent.src).toBe("/resources/audio/track.mp3");
    expect(sent.isPlaying).toBe(true);
    // Was `undefined`: the sender restarted from 0 while other clients sought elsewhere.
    expect(sent.currentTime).toBe(23.5);
    wrapper.unmount();
  });

  it("every Play starts a new run id; Pause keeps it", async () => {
    reset();
    const { wrapper } = mountAudio();
    press("1");
    const first = store().audios[0].playId;
    expect(typeof first).toBe("string");
    press("1"); // pause
    expect(store().audios[0].playId).toBe(first);
    press("1"); // play again
    expect(store().audios[0].playId).not.toBe(first);
    wrapper.unmount();
  });

  it("stops listening for number keys once the toolbox is closed", async () => {
    reset();
    const { wrapper } = mountAudio();
    wrapper.unmount();
    press("1");
    expect(store().updateAudioStatus).not.toHaveBeenCalled();
  });
});
