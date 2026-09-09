// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Multi-server streaming (several Jitsi servers per performance): the store
 * tags own tiles with the publish server, resolves every tile to a server
 * for the viewer sessions, and only deletes tiles for a USER_LEFT that came
 * from the tile's own server. With a single configured server none of the
 * new fields are ever written — those cases pin the legacy payload shape.
 */

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn(() => Promise.resolve()) }));
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

const cfg = vi.hoisted(() => ({
  current: {
    STATIC_ASSETS_ENDPOINT: "/resources/",
    JITSI_ENDPOINT: "https://j1.test",
    JITSI_ENDPOINTS: ["https://j1.test", "https://j2.test"],
    JITSI_SERVER_COUNT: 2,
    RTMP_ENDPOINT: "",
    RTMP_ENDPOINTS: [] as string[],
    RTMP_SERVER_COUNT: 0,
    MQTT_CONNECTION: {},
  },
}));
vi.mock("config", () => ({
  get default() {
    return cfg.current;
  },
}));

import { useStageStore } from "./stage";

const J1 = "https://j1.test";
const J2 = "https://j2.test";

beforeEach(() => {
  setActivePinia(createPinia());
  sendMessage.mockClear();
  cfg.current.JITSI_ENDPOINTS = [J1, J2];
  cfg.current.JITSI_SERVER_COUNT = 2;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function fakeTrack(participantId: string, id: string) {
  return {
    getId: () => id,
    getParticipantId: () => participantId,
    type: "video",
  } as unknown as Parameters<ReturnType<typeof useStageStore>["addTrack"]>[0];
}

describe("multi-server jitsi (two servers configured)", () => {
  it("syncLocalJitsiParticipantId(id, server) records the publish server and stamps own tiles", () => {
    const s = useStageStore();
    s.session = "sess-A";
    const placed = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10 });
    expect(placed.jitsiServer).toBeUndefined(); // server unknown yet
    s.syncLocalJitsiParticipantId("p1", J2);
    expect(s.localJitsiServer).toBe(J2);
    const tile = s.board.objects.find((o) => o.id === placed.id)!;
    expect(tile.participantId).toBe("p1");
    expect(tile.jitsiServer).toBe(J2);
  });

  it("placeObjectOnStage stamps jitsiServer once the publish server is known", () => {
    const s = useStageStore();
    s.syncLocalJitsiParticipantId("p1", J2);
    const placed = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10 });
    expect(placed.jitsiServer).toBe(J2);
    expect(placed.participantId).toBe("p1");
    // A tile that already names a server keeps it (e.g. re-placed from a payload).
    const explicit = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10, jitsiServer: J1 });
    expect(explicit.jitsiServer).toBe(J1);
  });

  it("switching servers re-stamps own tiles (same id, new participantId + server)", () => {
    const s = useStageStore();
    s.session = "sess-A";
    s.syncLocalJitsiParticipantId("p1", J1);
    const placed = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10 });
    s.syncLocalJitsiParticipantId("p2", J2);
    const tile = s.board.objects.find((o) => o.id === placed.id)!;
    expect(tile.participantId).toBe("p2");
    expect(tile.jitsiServer).toBe(J2);
    expect(s.board.objects).toHaveLength(1);
  });

  it("jitsiServersInUse resolves tiles to origins (absent = default) and is sorted", () => {
    const s = useStageStore();
    expect(s.jitsiServersInUse).toEqual([]);
    s.PUSH_OBJECT({
      id: "a",
      type: "jitsi",
      participantId: "x",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotate: 0,
    });
    expect(s.jitsiServersInUse).toEqual([J1]);
    s.PUSH_OBJECT({
      id: "b",
      type: "jitsi",
      participantId: "y",
      jitsiServer: J2,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotate: 0,
    });
    s.PUSH_OBJECT({
      id: "c",
      type: "jitsi",
      participantId: "z",
      jitsiServer: "https://gone.test",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotate: 0,
    });
    // Unknown server falls back to the default; avatars are ignored.
    s.PUSH_OBJECT({ id: "d", type: "avatar", x: 0, y: 0, w: 1, h: 1, rotate: 0 });
    expect(s.jitsiServersInUse).toEqual([J1, J2]);
  });

  it("removeJitsiParticipantLocally(id, server) only removes tiles on that server", () => {
    const s = useStageStore();
    s.PUSH_OBJECT({
      id: "a",
      type: "jitsi",
      participantId: "same",
      jitsiServer: J2,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotate: 0,
    });
    s.PUSH_OBJECT({
      id: "b",
      type: "jitsi",
      participantId: "same",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotate: 0,
    });
    // USER_LEFT "same" reported by server 1 must not touch the server-2 tile.
    s.removeJitsiParticipantLocally("same", J1);
    expect(s.board.objects.map((o) => o.id)).toEqual(["a"]);
    s.removeJitsiParticipantLocally("same", J2);
    expect(s.board.objects).toEqual([]);
  });

  it("removeJitsiParticipantLocally without a server keeps the legacy behaviour (all tiles)", () => {
    const s = useStageStore();
    s.PUSH_OBJECT({
      id: "a",
      type: "jitsi",
      participantId: "same",
      jitsiServer: J2,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotate: 0,
    });
    s.PUSH_OBJECT({
      id: "b",
      type: "jitsi",
      participantId: "same",
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      rotate: 0,
    });
    s.removeJitsiParticipantLocally("same");
    expect(s.board.objects).toEqual([]);
  });

  it("addTrack(track, server) tags the track; trackServer reads it back through the reactive proxy", () => {
    const s = useStageStore();
    const t = fakeTrack("p9", "t9");
    s.addTrack(t, J2);
    const fromStore = s.jitsiTracks[0];
    expect(s.trackServer(fromStore)).toBe(J2);
    const untagged = fakeTrack("p8", "t8");
    s.addTrack(untagged);
    expect(s.trackServer(s.jitsiTracks[1])).toBeUndefined();
  });

  it("CLEAN_STAGE forgets the publish server", () => {
    const s = useStageStore();
    s.syncLocalJitsiParticipantId("p1", J2);
    s.CLEAN_STAGE();
    expect(s.localJitsiServer).toBeNull();
  });
});

describe("single-server install (legacy payload shape)", () => {
  beforeEach(() => {
    cfg.current.JITSI_ENDPOINTS = [J1];
    cfg.current.JITSI_SERVER_COUNT = 1;
  });

  it("never writes jitsiServer onto a placed tile or a healed one", () => {
    const s = useStageStore();
    s.session = "sess-A";
    s.syncLocalJitsiParticipantId("p1");
    const placed = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10 });
    expect("jitsiServer" in placed).toBe(false);
    s.syncLocalJitsiParticipantId("p2");
    const tile = s.board.objects.find((o) => o.id === placed.id)!;
    expect(tile.participantId).toBe("p2");
    expect("jitsiServer" in tile).toBe(false);
    expect(s.localJitsiServer).toBeNull();
  });
});
