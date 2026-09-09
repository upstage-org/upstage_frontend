// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref, shallowRef } from "vue";

/**
 * Multi-server streaming: own tiles bound to a server other than the default
 * are published there from the SAME camera — the primary local tracks are
 * cloned (MediaStreamTrack.clone → createLocalTracksFromMediaStreams) and
 * added to that server's room; they are removed + disposed when the last
 * own tile on that server goes, and re-cloned when the primary tracks are
 * replaced. Single-server builds run none of it.
 */

const J1 = "https://j1.test";
const J2 = "https://j2.test";
const J3 = "https://j3.test";

const cfg = vi.hoisted(() => ({
  current: {
    JITSI_ENDPOINT: "https://j1.test",
    JITSI_ENDPOINTS: ["https://j1.test", "https://j2.test", "https://j3.test"],
    JITSI_SERVER_COUNT: 3,
  } as Record<string, unknown>,
}));
vi.mock("config", () => ({
  get default() {
    return cfg.current;
  },
}));

const mocks = vi.hoisted(() => {
  const createLocalTracksFromMediaStreams = vi.fn();
  return {
    JitsiMeetJS: { createLocalTracksFromMediaStreams },
    createLocalTracksFromMediaStreams,
  };
});
vi.mock("./composable", () => ({ useLowLevelAPI: () => mocks.JitsiMeetJS }));

const storeMocks = vi.hoisted(() => ({ store: null as unknown as Record<string, unknown> }));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    board: { objects: [] as Array<Record<string, unknown>> },
    session: "sess-1",
    canPlay: true,
    jitsiStreamingEnabled: true,
    status: "LIVE",
    reloadStreams: null as number | null,
    forceReloadStreams: null as number | null,
    localJitsiParticipantIds: {} as Record<string, string>,
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    ensureJitsiTileParticipantBroadcast: vi.fn(),
  });
  storeMocks.store = store as unknown as Record<string, unknown>;
  return { useStageStore: () => store };
});

import { useExtraServerPublishers } from "./extraServerPublishers";

type FakeMst = { kind: string; clone: ReturnType<typeof vi.fn>; stopped: boolean };
type FakeLocalTrack = {
  type: string;
  ended: boolean;
  isEnded: () => boolean;
  getTrack: () => FakeMst;
  getId: () => string;
};
type FakeClone = { id: string; mediaType: string; dispose: ReturnType<typeof vi.fn> };

let seq = 0;
function fakeMst(kind: string): FakeMst {
  const mst: FakeMst = {
    kind,
    stopped: false,
    clone: vi.fn(() => ({ kind, stop: vi.fn(), id: `clone-${kind}-${seq++}` })),
  };
  return mst;
}
function fakePrimary(kind: string): FakeLocalTrack {
  const mst = fakeMst(kind);
  const id = `primary-${kind}-${seq++}`;
  const t: FakeLocalTrack = {
    type: kind,
    ended: false,
    isEnded: () => t.ended,
    getTrack: () => mst,
    getId: () => id,
  };
  return t;
}
function makeRoom(myId: string) {
  return {
    myUserId: () => myId,
    addTrack: vi.fn<(t: unknown) => Promise<void>>(async () => {}),
    removeTrack: vi.fn<(t: unknown) => Promise<void>>(async () => {}),
  };
}
function makeSession(room: ReturnType<typeof makeRoom> | null, joined = true) {
  return { joined: ref(joined), target: { room, connection: null } };
}

const store = () =>
  storeMocks.store as unknown as {
    board: { objects: Array<Record<string, unknown>> };
    localJitsiParticipantIds: Record<string, string>;
    canPlay: boolean;
    status: string;
    forceReloadStreams: number | null;
    addTrack: ReturnType<typeof vi.fn>;
    removeTrack: ReturnType<typeof vi.fn>;
    ensureJitsiTileParticipantBroadcast: ReturnType<typeof vi.fn>;
  };

const mounted: Array<{ unmount: () => void }> = [];
function mountPublishers(sessions: Map<string, unknown>) {
  const localTracks = shallowRef<unknown[]>([]);
  const jitsi = { room: null, connection: null, localTracks, sessions };
  let api!: ReturnType<typeof useExtraServerPublishers>;
  const Comp = defineComponent({
    setup() {
      api = useExtraServerPublishers(jitsi as never, {} as never);
      return () => h("div");
    },
  });
  const wrapper = mount(Comp);
  mounted.push(wrapper);
  return { api, jitsi, localTracks };
}

const clonesCreated: FakeClone[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  clonesCreated.length = 0;
  cfg.current.JITSI_ENDPOINTS = [J1, J2, J3];
  cfg.current.JITSI_SERVER_COUNT = 3;
  // jsdom has no MediaStream; the module wraps each clone in one.
  (globalThis as { MediaStream?: unknown }).MediaStream = class {
    tracks: unknown[];
    constructor(tracks: unknown[]) {
      this.tracks = tracks;
    }
  };
  mocks.createLocalTracksFromMediaStreams.mockImplementation(
    (infos: Array<{ mediaType: string }>) =>
      infos.map((info) => {
        const c: FakeClone = { id: `jt-${seq++}`, mediaType: info.mediaType, dispose: vi.fn() };
        clonesCreated.push(c);
        return c;
      }),
  );
  const s = store();
  s.board.objects = [];
  s.localJitsiParticipantIds = {};
  s.canPlay = true;
  s.status = "LIVE";
  s.forceReloadStreams = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
});

describe("useExtraServerPublishers", () => {
  it("publishes clones of the primary tracks into server B's room once an own tile is on B", async () => {
    const roomB = makeRoom("meB");
    const sessions = new Map<string, unknown>([[J2, makeSession(roomB)]]);
    const { api, localTracks } = mountPublishers(sessions);
    const primary = [fakePrimary("audio"), fakePrimary("video")];
    localTracks.value = primary;
    store().localJitsiParticipantIds = { [J1]: "meA", [J2]: "meB" };
    await flushPromises();
    // No own tile on B yet → nothing sent anywhere.
    expect(roomB.addTrack).not.toHaveBeenCalled();
    expect(api.publishedOrigins()).toEqual([]);

    store().board.objects = [
      { id: "t1", type: "jitsi", hostId: "sess-1", participantId: "meB", jitsiServer: J2 },
    ];
    await flushPromises();
    // Both primary MediaStreamTracks were cloned (never the originals sent).
    for (const t of primary) expect(t.getTrack().clone).toHaveBeenCalledTimes(1);
    const infos = mocks.createLocalTracksFromMediaStreams.mock.calls[0][0] as Array<{
      mediaType: string;
      videoType?: string;
    }>;
    expect(infos.map((i) => i.mediaType)).toEqual(["audio", "video"]);
    expect(infos.find((i) => i.mediaType === "video")?.videoType).toBe("camera");
    expect(roomB.addTrack).toHaveBeenCalledTimes(2);
    expect(roomB.addTrack.mock.calls.map((c) => c[0])).toEqual(clonesCreated);
    // Store learns the clones tagged with B so B's tile picks them up.
    expect(store().addTrack).toHaveBeenCalledTimes(2);
    for (const call of store().addTrack.mock.calls) expect(call[1]).toBe(J2);
    expect(store().ensureJitsiTileParticipantBroadcast).toHaveBeenCalledWith("meB", J2);
    expect(api.publishedOrigins()).toEqual([J2]);
  });

  it("does not publish to a server whose session is not joined, then publishes when it joins", async () => {
    const roomB = makeRoom("meB");
    const sessionB = makeSession(roomB, false);
    const sessions = new Map<string, unknown>([[J2, sessionB]]);
    const { api, localTracks } = mountPublishers(sessions);
    localTracks.value = [fakePrimary("audio"), fakePrimary("video")];
    store().board.objects = [{ id: "t1", type: "jitsi", hostId: "sess-1", jitsiServer: J2 }];
    await flushPromises();
    expect(roomB.addTrack).not.toHaveBeenCalled();
    expect(api.publishedOrigins()).toEqual([]);
    // CONFERENCE_JOINED on B: composable flips the session and records the id.
    sessionB.joined.value = true;
    store().localJitsiParticipantIds = { [J2]: "meB" };
    await flushPromises();
    expect(roomB.addTrack).toHaveBeenCalledTimes(2);
    expect(api.publishedOrigins()).toEqual([J2]);
  });

  it("removes + disposes the clones when the last own tile on B is closed, keeping the primary tracks", async () => {
    const roomB = makeRoom("meB");
    const sessions = new Map<string, unknown>([[J2, makeSession(roomB)]]);
    const { api, localTracks } = mountPublishers(sessions);
    const primary = [fakePrimary("audio"), fakePrimary("video")];
    localTracks.value = primary;
    store().localJitsiParticipantIds = { [J2]: "meB" };
    store().board.objects = [{ id: "t1", type: "jitsi", hostId: "sess-1", jitsiServer: J2 }];
    await flushPromises();
    expect(api.publishedOrigins()).toEqual([J2]);
    const clones = clonesCreated.slice();

    store().board.objects = [];
    await flushPromises();
    expect(roomB.removeTrack).toHaveBeenCalledTimes(2);
    expect(roomB.removeTrack.mock.calls.map((c) => c[0])).toEqual(clones);
    for (const c of clones) expect(c.dispose).toHaveBeenCalledTimes(1);
    expect(store().removeTrack).toHaveBeenCalledTimes(2);
    expect(api.publishedOrigins()).toEqual([]);
    // The camera capture itself is the primary publisher's; untouched here.
    expect(localTracks.value).toBe(primary);
    for (const t of primary) expect(t.ended).toBe(false);
  });

  it("serves several servers at once and keeps them independent", async () => {
    const roomB = makeRoom("meB");
    const roomC = makeRoom("meC");
    const sessions = new Map<string, unknown>([
      [J2, makeSession(roomB)],
      [J3, makeSession(roomC)],
    ]);
    const { api, localTracks } = mountPublishers(sessions);
    localTracks.value = [fakePrimary("audio"), fakePrimary("video")];
    store().localJitsiParticipantIds = { [J2]: "meB", [J3]: "meC" };
    store().board.objects = [
      { id: "b", type: "jitsi", hostId: "sess-1", jitsiServer: J2 },
      { id: "c", type: "jitsi", hostId: "sess-1", jitsiServer: J3 },
      // A default-server tile is the primary publisher's business.
      { id: "a", type: "jitsi", hostId: "sess-1" },
    ];
    await flushPromises();
    expect(roomB.addTrack).toHaveBeenCalledTimes(2);
    expect(roomC.addTrack).toHaveBeenCalledTimes(2);
    // Distinct clone sets per server: a JitsiLocalTrack belongs to one room.
    const sentToB = roomB.addTrack.mock.calls.map((c) => c[0]);
    const sentToC = roomC.addTrack.mock.calls.map((c) => c[0]);
    expect(sentToB.some((t) => sentToC.includes(t))).toBe(false);
    expect(api.publishedOrigins().sort()).toEqual([J2, J3]);

    // Closing the tile on C leaves B untouched.
    store().board.objects = store().board.objects.filter((o) => o.id !== "c");
    await flushPromises();
    expect(roomC.removeTrack).toHaveBeenCalledTimes(2);
    expect(roomB.removeTrack).not.toHaveBeenCalled();
    expect(api.publishedOrigins()).toEqual([J2]);
  });

  it("re-clones when the primary tracks are replaced (device change / re-acquire)", async () => {
    const roomB = makeRoom("meB");
    const sessions = new Map<string, unknown>([[J2, makeSession(roomB)]]);
    const { api, localTracks } = mountPublishers(sessions);
    localTracks.value = [fakePrimary("audio"), fakePrimary("video")];
    store().localJitsiParticipantIds = { [J2]: "meB" };
    store().board.objects = [{ id: "t1", type: "jitsi", hostId: "sess-1", jitsiServer: J2 }];
    await flushPromises();
    const firstClones = clonesCreated.slice();
    expect(firstClones).toHaveLength(2);

    localTracks.value = [fakePrimary("audio"), fakePrimary("video")];
    await flushPromises();
    for (const c of firstClones) expect(c.dispose).toHaveBeenCalledTimes(1);
    expect(roomB.removeTrack).toHaveBeenCalledTimes(2);
    expect(roomB.addTrack).toHaveBeenCalledTimes(4);
    expect(clonesCreated).toHaveLength(4);
    expect(api.publishedOrigins()).toEqual([J2]);
  });

  it("Refresh streams re-sends the same clones (remove + add) on every published server", async () => {
    const roomB = makeRoom("meB");
    const sessions = new Map<string, unknown>([[J2, makeSession(roomB)]]);
    const { localTracks } = mountPublishers(sessions);
    localTracks.value = [fakePrimary("audio"), fakePrimary("video")];
    store().localJitsiParticipantIds = { [J2]: "meB" };
    store().board.objects = [{ id: "t1", type: "jitsi", hostId: "sess-1", jitsiServer: J2 }];
    await flushPromises();
    const clones = clonesCreated.slice();
    store().forceReloadStreams = 1;
    await flushPromises();
    expect(roomB.removeTrack.mock.calls.map((c) => c[0])).toEqual(clones);
    expect(roomB.addTrack).toHaveBeenCalledTimes(4);
    for (const c of clones) expect(c.dispose).not.toHaveBeenCalled();
    expect(clonesCreated).toHaveLength(2); // no re-clone on refresh
  });

  it("never publishes for an audience tab (canPlay false)", async () => {
    const roomB = makeRoom("meB");
    const sessions = new Map<string, unknown>([[J2, makeSession(roomB)]]);
    store().canPlay = false;
    const { api, localTracks } = mountPublishers(sessions);
    localTracks.value = [fakePrimary("audio"), fakePrimary("video")];
    store().localJitsiParticipantIds = { [J2]: "meB" };
    store().board.objects = [{ id: "t1", type: "jitsi", hostId: "sess-1", jitsiServer: J2 }];
    await flushPromises();
    expect(roomB.addTrack).not.toHaveBeenCalled();
    expect(mocks.createLocalTracksFromMediaStreams).not.toHaveBeenCalled();
    expect(api.publishedOrigins()).toEqual([]);
  });

  it("disposes the clones on unmount", async () => {
    const roomB = makeRoom("meB");
    const sessions = new Map<string, unknown>([[J2, makeSession(roomB)]]);
    const { localTracks } = mountPublishers(sessions);
    localTracks.value = [fakePrimary("audio"), fakePrimary("video")];
    store().localJitsiParticipantIds = { [J2]: "meB" };
    store().board.objects = [{ id: "t1", type: "jitsi", hostId: "sess-1", jitsiServer: J2 }];
    await flushPromises();
    const clones = clonesCreated.slice();
    mounted.pop()?.unmount();
    for (const c of clones) expect(c.dispose).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on a single-server build", async () => {
    cfg.current.JITSI_ENDPOINTS = [J1];
    cfg.current.JITSI_SERVER_COUNT = 1;
    const roomB = makeRoom("meB");
    const sessions = new Map<string, unknown>([[J2, makeSession(roomB)]]);
    const { api, localTracks } = mountPublishers(sessions);
    localTracks.value = [fakePrimary("audio"), fakePrimary("video")];
    store().board.objects = [{ id: "t1", type: "jitsi", hostId: "sess-1", jitsiServer: J2 }];
    await flushPromises();
    expect(roomB.addTrack).not.toHaveBeenCalled();
    expect(api.publishedOrigins()).toEqual([]);
  });
});
