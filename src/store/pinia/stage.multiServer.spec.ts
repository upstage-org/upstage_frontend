// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Multi-server streaming (several Jitsi servers per performance): a tile is
 * bound to ONE server (`jitsiServer`, carried in the per-server Yourself
 * tile's drag payload), the store keeps this tab's participant id PER server
 * and heals own tiles only with the id of their own server, resolves every
 * tile to a server for the sessions, and only deletes tiles for a USER_LEFT
 * that came from the tile's own server. With a single configured server none
 * of the new fields are ever written — those cases pin the legacy payload
 * shape.
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
  it("syncLocalJitsiParticipantId(id, server) records the id per server and heals only that server's own tiles", () => {
    const s = useStageStore();
    s.session = "sess-A";
    const onDefault = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10 });
    const onJ2 = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10, jitsiServer: J2 });
    expect(onDefault.jitsiServer).toBeUndefined(); // no server is ever inferred
    s.syncLocalJitsiParticipantId("p2", J2);
    expect(s.localJitsiParticipantIds).toEqual({ [J2]: "p2" });
    const tile2 = s.board.objects.find((o) => o.id === onJ2.id)!;
    const tile1 = s.board.objects.find((o) => o.id === onDefault.id)!;
    expect(tile2.participantId).toBe("p2");
    expect(tile2.jitsiServer).toBe(J2);
    // The default-server tile is untouched by server B's join.
    expect(tile1.participantId).toBeUndefined();
    expect("jitsiServer" in tile1).toBe(false);
    s.syncLocalJitsiParticipantId("p1", J1);
    expect(s.localJitsiParticipantIds).toEqual({ [J2]: "p2", [J1]: "p1" });
    expect(s.board.objects.find((o) => o.id === onDefault.id)!.participantId).toBe("p1");
    expect(s.board.objects.find((o) => o.id === onJ2.id)!.participantId).toBe("p2");
  });

  it("placeObjectOnStage stamps the participant id of the tile's OWN server", () => {
    const s = useStageStore();
    s.syncLocalJitsiParticipantId("p1", J1);
    s.syncLocalJitsiParticipantId("p2", J2);
    const onJ2 = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10, jitsiServer: J2 });
    expect(onJ2.participantId).toBe("p2");
    expect(onJ2.jitsiServer).toBe(J2);
    const onJ1 = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10, jitsiServer: J1 });
    expect(onJ1.participantId).toBe("p1");
    // A legacy tile without a server resolves to the default server's id.
    const legacy = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10 });
    expect(legacy.participantId).toBe("p1");
    expect("jitsiServer" in legacy).toBe(false);
  });

  it("a tile on a server this tab has not joined yet waits for that server's id", () => {
    const s = useStageStore();
    s.session = "sess-A";
    s.syncLocalJitsiParticipantId("p1", J1);
    const onJ2 = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10, jitsiServer: J2 });
    expect(onJ2.participantId).toBeUndefined(); // never server A's id
    s.syncLocalJitsiParticipantId("p2", J2);
    expect(s.board.objects.find((o) => o.id === onJ2.id)!.participantId).toBe("p2");
  });

  it("ensureJitsiTileParticipantBroadcast(id, server) leaves own tiles on other servers alone", () => {
    const s = useStageStore();
    // Minimal model making `canPlay` truthy (the broadcast is player-only).
    s.model = { permission: "player", attributes: [] } as never;
    s.session = "sess-A";
    s.syncLocalJitsiParticipantId("p1", J1);
    s.syncLocalJitsiParticipantId("p2", J2);
    const onJ1 = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10, jitsiServer: J1 });
    const onJ2 = s.placeObjectOnStage({ type: "jitsi", w: 10, h: 10, jitsiServer: J2 });
    s.ensureJitsiTileParticipantBroadcast("p2-new", J2);
    expect(s.board.objects.find((o) => o.id === onJ2.id)!.participantId).toBe("p2-new");
    expect(s.board.objects.find((o) => o.id === onJ1.id)!.participantId).toBe("p1");
  });

  it("leaving a server (id null) forgets only that server's id", () => {
    const s = useStageStore();
    s.syncLocalJitsiParticipantId("p1", J1);
    s.syncLocalJitsiParticipantId("p2", J2);
    s.syncLocalJitsiParticipantId(null, J2);
    expect(s.localJitsiParticipantIds).toEqual({ [J1]: "p1" });
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

  it("CLEAN_STAGE forgets every per-server participant id", () => {
    const s = useStageStore();
    s.syncLocalJitsiParticipantId("p1", J2);
    s.CLEAN_STAGE();
    expect(s.localJitsiParticipantIds).toEqual({});
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
    expect(s.localJitsiParticipantIds).toEqual({});
  });
});
