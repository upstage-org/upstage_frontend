// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * CLEAN_STAGE(true) runs at the start of every loadStage. SET_MODEL pushes
 * onto the toolbox buckets, so any bucket it does not reset carries over
 * to the next stage: the Streams palette listed the previous stage's
 * meetings, and audioPlayers kept positions for tracks that no longer
 * existed. A partial clean (cleanModel false) must leave both alone.
 */

vi.mock("@services/mqtt", () => ({
  default: () => ({
    connect: vi.fn(),
    whenConnected: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => Promise.resolve()),
    sendMessage: vi.fn(() => Promise.resolve()),
    sendMessageSync: vi.fn(),
    receiveMessage: vi.fn(),
  }),
}));
vi.mock("@services/speech", () => ({ avatarSpeak: vi.fn(), stopSpeaking: vi.fn() }));
vi.mock("config", () => ({
  default: {
    STATIC_ASSETS_ENDPOINT: "/resources/",
    JITSI_ENDPOINT: "https://j1.test",
    JITSI_ENDPOINTS: ["https://j1.test"],
    JITSI_SERVER_COUNT: 1,
    RTMP_ENDPOINT: "",
    RTMP_ENDPOINTS: [] as string[],
    RTMP_SERVER_COUNT: 0,
    MQTT_CONNECTION: {},
  },
}));

import { useStageStore } from "./stage";

beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("CLEAN_STAGE toolbox buckets", () => {
  it("a full clean drops the previous stage's meetings and audio player state", () => {
    const s = useStageStore();
    s.CREATE_ROOM({ id: 1, name: "room-a", type: "meeting" } as never);
    s.tools.audios.push({ id: 2, name: "track", src: "/resources/a.mp3" } as never);
    s.audioPlayers.push({ currentTime: 12 } as never);
    expect(s.tools.meetings).toHaveLength(1);

    s.CLEAN_STAGE(true);

    expect(s.tools.meetings).toEqual([]);
    expect(s.tools.audios).toEqual([]);
    expect(s.audioPlayers).toEqual([]);
  });

  it("a partial clean keeps meetings, audios and audio players (unchanged path)", () => {
    const s = useStageStore();
    s.CREATE_ROOM({ id: 1, name: "room-a", type: "meeting" } as never);
    s.tools.audios.push({ id: 2, name: "track", src: "/resources/a.mp3" } as never);
    s.audioPlayers.push({ currentTime: 12 } as never);

    s.CLEAN_STAGE(false);

    expect(s.tools.meetings).toHaveLength(1);
    expect(s.tools.audios).toHaveLength(1);
    expect(s.audioPlayers).toHaveLength(1);
    // Per-stage presence is still reset either way.
    expect(s.sessions).toEqual([]);
  });
});
