// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Master audio controls.
 *
 * Per-track stops only take effect on the broker echo (AudioPlayer.vue
 * pauses on the `changed` flag set by UPDATE_AUDIO). Stop-all / fade-out's
 * "snap master back to full" therefore must not be applied locally: it
 * used to set every still-playing element back to full volume for the
 * split second before the pause landed. It travels over MQTT, published
 * AFTER the stops, and is applied by the echo on every client.
 */

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn(() => Promise.resolve()),
}));
vi.mock("@services/mqtt", () => ({
  default: () => ({
    connect: vi.fn(),
    whenConnected: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => Promise.resolve()),
    sendMessage,
    sendMessageSync: vi.fn(),
    receiveMessage: vi.fn(),
  }),
}));
vi.mock("@services/speech", () => ({
  avatarSpeak: vi.fn(),
  stopSpeaking: vi.fn(),
}));

import { useStageStore } from "./stage";
import { TOPICS } from "@utils/constants";

type StageStore = ReturnType<typeof useStageStore>;
type Audio = StageStore["tools"]["audios"][number];

const topics = () => (sendMessage.mock.calls as unknown as [string, unknown][]).map(([t]) => t);

let store: StageStore;
beforeEach(() => {
  setActivePinia(createPinia());
  store = useStageStore();
  store.tools.audios.push(
    { src: "hen1.mp3", name: "Hen 1", isPlaying: true, volume: 1 } as unknown as Audio,
    { src: "hen2.mp3", name: "Hen 2", isPlaying: true, volume: 1 } as unknown as Audio,
  );
  sendMessage.mockClear();
});

describe("stopAllAudio", () => {
  it("publishes the master reset after the track stops instead of applying it locally", () => {
    store.setMasterAudioVolume(0.4);
    sendMessage.mockClear();

    store.stopAllAudio();

    expect(store.masterAudioVolume).toBe(0.4);
    expect(topics()).toEqual([TOPICS.AUDIO, TOPICS.AUDIO, TOPICS.AUDIO_MASTER]);
    const master = sendMessage.mock.calls[2] as unknown as [
      string,
      { volume: number; duration: number },
    ];
    expect(master[1]).toEqual({ volume: 1, duration: 0 });

    // Broker echo lands (after the stop echoes) and applies it.
    store.handleAudioMasterMessage({ message: master[1] });
    expect(store.masterAudioVolume).toBe(1);
    expect(store.masterAudioSignal).toMatchObject({ volume: 1, duration: 0 });
  });

  it("does not publish a reset when master is already at full", () => {
    store.stopAllAudio();
    expect(topics()).toEqual([TOPICS.AUDIO, TOPICS.AUDIO]);
  });
});

describe("fadeOutAllAudio", () => {
  it("ramps to silence, then stops the tracks and defers the reset to the echo", () => {
    vi.useFakeTimers();
    try {
      store.fadeOutAllAudio();
      expect(store.masterAudioVolume).toBe(0);
      expect(store.masterAudioSignal).toMatchObject({ volume: 0, duration: 3000 });
      expect(topics()).toEqual([TOPICS.AUDIO_MASTER]);

      vi.advanceTimersByTime(3000);
      expect(topics()).toEqual([
        TOPICS.AUDIO_MASTER,
        TOPICS.AUDIO,
        TOPICS.AUDIO,
        TOPICS.AUDIO_MASTER,
      ]);
      // Still silent locally until the echo: no burst of full volume while
      // the element is waiting on its pause.
      expect(store.masterAudioVolume).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
