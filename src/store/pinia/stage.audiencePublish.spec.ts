// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Audience sessions must never affect a performance (only chat text and
 * reactions). The stage store enforces that at its single publish function.
 *
 * Found 2026-09: AudioPlayer.vue is mounted for everyone, and its `ended`
 * handler published a "stop" for the track from EVERY client. An audience
 * session whose playback lagged could thereby stop a track the performer had
 * just started again. Also pinned here: between performers, a late
 * end-of-track stop for an old run must not end the new run.
 */

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn(() => Promise.resolve("sent")),
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
vi.mock("@services/speech", () => ({ avatarSpeak: vi.fn(), stopSpeaking: vi.fn() }));

import { useStageStore } from "./stage";
import { TOPICS } from "@utils/constants";

type StageStore = ReturnType<typeof useStageStore>;
type Audio = StageStore["tools"]["audios"][number];

const topics = () => (sendMessage.mock.calls as unknown as [string, unknown][]).map(([t]) => t);
const track = (extra: Record<string, unknown> = {}) =>
  ({ src: "drone.mp3", name: "Drone", isPlaying: true, volume: 1, ...extra }) as unknown as Audio;

let store: StageStore;
const as = (permission: string | null) => {
  store.model = (permission ? { permission, attributes: [] } : null) as never;
};

beforeEach(() => {
  setActivePinia(createPinia());
  store = useStageStore();
  store.tools.audios.push(track());
  sendMessage.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("audience sessions cannot publish performance state", () => {
  it("an audience session's audio update never reaches the broker", async () => {
    as("audience");
    await expect(
      store.updateAudioStatus(track({ isPlaying: false, currentTime: 0 })),
    ).toBeUndefined();
    store.stopAllAudio();
    store.setMasterAudioVolume(0.2);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("nor do board, backdrop or drawing actions", () => {
    as("audience");
    store.bringToFrontOf({ front: "a", back: "b" });
    store.sendDrawWhiteboard?.({ type: "line" } as never);
    store.sendClearWhiteboard?.();
    store.clearChat?.();
    expect(topics().filter((t) => t !== TOPICS.COUNTER)).toEqual([]);
  });

  it("the same holds before a stage model is loaded, while masquerading and in replay", () => {
    as(null);
    store.updateAudioStatus(track({ isPlaying: false }));
    as("owner");
    store.masquerading = true;
    store.updateAudioStatus(track({ isPlaying: false }));
    store.masquerading = false;
    store.SET_REPLAY({ isReplaying: true });
    store.updateAudioStatus(track({ isPlaying: false }));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("audience chat text and reactions still go out", () => {
    as("audience");
    store.sendChat({ message: "bravo" } as never);
    store.sendReaction("👏" as never);
    expect(topics()).toEqual(expect.arrayContaining([TOPICS.CHAT, TOPICS.REACTION]));
    // …and an audience chat line never makes an avatar speak on the board.
    expect(topics()).not.toContain(TOPICS.BOARD);
  });

  it("a performer publishes exactly as before", () => {
    as("owner");
    store.updateAudioStatus(track({ isPlaying: false }));
    expect(topics()).toEqual([TOPICS.AUDIO]);
  });
});

describe("a late end-of-track stop cannot end a newer run", () => {
  const current = () => store.tools.audios[0] as unknown as Record<string, unknown>;

  it("ignores the automatic stop of a previous run", () => {
    store.handleAudioMessage({ message: track({ isPlaying: true, playId: "run-2" }) });
    // A lagging client's copy of run-1 finishes only now:
    store.handleAudioMessage({
      message: track({ isPlaying: false, currentTime: 0, endedPlayId: "run-1" }),
    });
    expect(current().isPlaying).toBe(true);
    expect(current().playId).toBe("run-2");
  });

  it("applies the automatic stop of the current run", () => {
    store.handleAudioMessage({ message: track({ isPlaying: true, playId: "run-2" }) });
    store.handleAudioMessage({
      message: track({ isPlaying: false, currentTime: 0, playId: "run-2", endedPlayId: "run-2" }),
    });
    expect(current().isPlaying).toBe(false);
    expect(current().changed).toBe(true);
    // The marker is not kept on the track, or the next Play would carry it.
    expect("endedPlayId" in current()).toBe(false);
  });

  it("a deliberate stop (no endedPlayId) always applies", () => {
    store.handleAudioMessage({ message: track({ isPlaying: true, playId: "run-2" }) });
    store.handleAudioMessage({ message: track({ isPlaying: false, currentTime: 0 }) });
    expect(current().isPlaying).toBe(false);
  });

  it("tracks started without a run id (older bundles, scenes) behave as before", () => {
    store.handleAudioMessage({ message: track({ isPlaying: true }) });
    store.handleAudioMessage({
      message: track({ isPlaying: false, currentTime: 0, endedPlayId: null }),
    });
    expect(current().isPlaying).toBe(false);
  });
});
