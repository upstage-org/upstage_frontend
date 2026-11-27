// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref, shallowRef } from "vue";

/**
 * Toolbar self-preview lifecycle regressions (2026-08-25 report: "the
 * thumbnail of my individual jitsi stream disappears from the toolbar"):
 *
 *  1. Closing the own on-stage tile must UNPUBLISH (conference.removeTrack)
 *     but never DISPOSE the local tracks — JitsiLocalTrack.dispose() stops
 *     the camera stream and detaches every attached element, which blanked
 *     the Yourself.vue preview permanently.
 *  2. Re-placing the tile must re-publish the same tracks.
 *  3. Spurious DEVICE_LIST_CHANGED (Chromium fires it right after
 *     getUserMedia and on wake/focus) must not dispose+re-create healthy
 *     tracks even when they are NOT published (preview-only state) — that
 *     churn is what intermittently killed the thumbnail on drag / while a
 *     Meeting iframe held the camera.
 *  4. A genuinely ended track (device unplugged) must still re-acquire.
 */

const mocks = vi.hoisted(() => {
  const createLocalTracks = vi.fn();
  const deviceListeners: Array<() => void> = [];
  const browser = { firefox: false };
  const JitsiMeetJS = {
    util: { browser: { isFirefox: () => browser.firefox } },
    createLocalTracks,
    events: { mediaDevices: { DEVICE_LIST_CHANGED: "devicelistchanged" } },
    mediaDevices: {
      addEventListener: (_ev: string, cb: () => void) => {
        deviceListeners.push(cb);
      },
      removeEventListener: () => {},
    },
  };
  return { JitsiMeetJS, createLocalTracks, deviceListeners, browser };
});

const storeMocks = vi.hoisted(() => ({ store: null as unknown as Record<string, unknown> }));

vi.mock("./composable", () => ({ useLowLevelAPI: () => mocks.JitsiMeetJS }));
// Partial mock: the publisher also reads `resolveJitsiOrigin` (multi-server
// tile filter), which must stay real — the build under test may list more
// than one server via .env.
vi.mock("@utils/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@utils/common")>()),
  isJitsiBoardType: (t: string) => t === "jitsi",
}));
vi.mock("@composables/usePageWakeRecovery", () => ({ usePageWakeRecovery: vi.fn() }));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    board: { objects: [] as Array<Record<string, unknown>> },
    session: "sess-1",
    canPlay: true,
    jitsiStreamingEnabled: true,
    status: "LIVE",
    reloadStreams: null,
    forceReloadStreams: null,
    addTrack: vi.fn(),
    ensureJitsiTileParticipantBroadcast: vi.fn(),
  });
  storeMocks.store = store as unknown as Record<string, unknown>;
  return { useStageStore: () => store };
});

import { useLocalStreamPublisher } from "./localStreamPublisher";

type FakeTrack = {
  type: string;
  ended: boolean;
  isEnded: () => boolean;
  dispose: ReturnType<typeof vi.fn>;
  getId: () => string;
};

let trackSeq = 0;
function fakeTrack(type: string): FakeTrack {
  const id = `${type}-${trackSeq++}`;
  const track: FakeTrack = {
    type,
    ended: false,
    isEnded() {
      return track.ended;
    },
    dispose: vi.fn(),
    getId: () => id,
  };
  return track;
}

function makeRoom() {
  return {
    myUserId: () => "me",
    addTrack: vi.fn(async () => {}),
    removeTrack: vi.fn(async () => {}),
  };
}

const mountedWrappers: Array<{ unmount: () => void }> = [];

function mountPublisher() {
  const room = makeRoom();
  const localTracks = shallowRef<unknown[]>([]);
  const jitsi = { room, localTracks };
  const joined = ref(true);
  let api!: ReturnType<typeof useLocalStreamPublisher>;
  const Comp = defineComponent({
    setup() {
      api = useLocalStreamPublisher(jitsi as never, joined);
      return () => h("div");
    },
  });
  const wrapper = mount(Comp);
  mountedWrappers.push(wrapper);
  return { wrapper, api, jitsi, joined, room, localTracks };
}

const store = () =>
  storeMocks.store as Record<string, never> & {
    board: { objects: Array<Record<string, unknown>> };
  };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.browser.firefox = false;
  mocks.deviceListeners.length = 0;
  // jsdom does not reliably report a secure context; the acquire path
  // hard-blocks without it.
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  if (storeMocks.store) {
    store().board.objects = [];
  }
});

afterEach(() => {
  while (mountedWrappers.length) mountedWrappers.pop()?.unmount();
});

describe("useLocalStreamPublisher — toolbar preview survival", () => {
  it("unpublishes but keeps local tracks when the own tile is closed, and republishes on re-drag", async () => {
    const pair = [fakeTrack("audio"), fakeTrack("video")];
    mocks.createLocalTracks.mockResolvedValue(pair);
    const { jitsi, room } = mountPublisher();
    await flushPromises();
    expect(jitsi.localTracks.value).toHaveLength(2);

    // Drag the preview onto the stage: board watcher publishes both tracks.
    store().board.objects = [{ type: "jitsi", participantId: "me", id: 1 }];
    await flushPromises();
    expect(room.addTrack).toHaveBeenCalledTimes(2);

    // Close the on-stage tile: must remove from the room…
    store().board.objects = [];
    await flushPromises();
    expect(room.removeTrack).toHaveBeenCalledTimes(2);
    // …but the preview's tracks must stay alive and attached.
    for (const t of pair) expect(t.dispose).not.toHaveBeenCalled();
    expect(jitsi.localTracks.value).toHaveLength(2);

    // Re-drag: the SAME tracks are published again.
    store().board.objects = [{ type: "jitsi", participantId: "me", id: 2 }];
    await flushPromises();
    expect(room.addTrack).toHaveBeenCalledTimes(4);
    for (const t of pair) expect(t.dispose).not.toHaveBeenCalled();
  });

  it("ignores spurious DEVICE_LIST_CHANGED while holding healthy unpublished tracks", async () => {
    const pair = [fakeTrack("audio"), fakeTrack("video")];
    mocks.createLocalTracks.mockResolvedValue(pair);
    mountPublisher();
    await flushPromises();
    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(1);

    mocks.deviceListeners.forEach((cb) => cb());
    await flushPromises();

    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(1);
    for (const t of pair) expect(t.dispose).not.toHaveBeenCalled();
  });

  it("still re-acquires on DEVICE_LIST_CHANGED when a track has genuinely ended", async () => {
    const pair = [fakeTrack("audio"), fakeTrack("video")];
    mocks.createLocalTracks.mockResolvedValue(pair);
    const { jitsi } = mountPublisher();
    await flushPromises();

    pair[1].ended = true;
    const fresh = [fakeTrack("audio"), fakeTrack("video")];
    mocks.createLocalTracks.mockResolvedValue(fresh);
    mocks.deviceListeners.forEach((cb) => cb());
    await flushPromises();

    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(2);
    for (const t of pair) expect(t.dispose).toHaveBeenCalled();
    expect(jitsi.localTracks.value).toHaveLength(2);
    expect(jitsi.localTracks.value).toContain(fresh[0]);
  });
});

describe("useLocalStreamPublisher — unmount while getUserMedia is pending", () => {
  it("disposes tracks that resolve after route teardown so the camera does not stay on", async () => {
    const pair = [fakeTrack("audio"), fakeTrack("video")];
    let release: ((tracks: FakeTrack[]) => void) | null = null;
    mocks.createLocalTracks.mockImplementation(
      () =>
        new Promise<FakeTrack[]>((resolve) => {
          release = resolve;
        }),
    );
    const { wrapper, jitsi } = mountPublisher();
    await flushPromises();
    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(1);

    // Navigate away before the browser answered the permission prompt.
    wrapper.unmount();
    mountedWrappers.pop();
    (release as unknown as (tracks: FakeTrack[]) => void)(pair);
    await flushPromises();

    for (const t of pair) expect(t.dispose).toHaveBeenCalledTimes(1);
    expect(jitsi.localTracks.value).toHaveLength(0);
  });

  it("keeps tracks that resolve while still mounted (unchanged path)", async () => {
    const pair = [fakeTrack("audio"), fakeTrack("video")];
    mocks.createLocalTracks.mockResolvedValue(pair);
    const { jitsi } = mountPublisher();
    await flushPromises();
    for (const t of pair) expect(t.dispose).not.toHaveBeenCalled();
    expect(jitsi.localTracks.value).toHaveLength(2);
  });
});

/**
 * Rejoin after a lost Jitsi connection (2026-11-21 rehearsal): useJitsi
 * replaces `jitsi.room` with a brand-new conference and flips `joined`
 * false → true. The new conference has none of our tracks, so the publisher
 * must add them again — the old `published` latch made it skip that, leaving
 * a performer "live" on a stage where nobody received their stream.
 */
describe("useLocalStreamPublisher — rejoin after the conference was lost", () => {
  it("re-adds the same local tracks to the new room without re-acquiring the camera", async () => {
    const pair = [fakeTrack("audio"), fakeTrack("video")];
    mocks.createLocalTracks.mockResolvedValue(pair);
    const { jitsi, joined, room } = mountPublisher();
    await flushPromises();
    store().board.objects = [{ type: "jitsi", participantId: "me", hostId: "sess-1", id: 1 }];
    await flushPromises();
    expect(room.addTrack).toHaveBeenCalledTimes(2);

    // Connection lost; useJitsi rejoins with a new room and a new id.
    joined.value = false;
    await flushPromises();
    const newRoom = { ...makeRoom(), myUserId: () => "me-2" };
    (jitsi as { room: unknown }).room = newRoom;
    joined.value = true;
    await flushPromises();

    expect(newRoom.addTrack).toHaveBeenCalledTimes(2);
    expect(newRoom.addTrack).toHaveBeenCalledWith(pair[0]);
    expect(newRoom.addTrack).toHaveBeenCalledWith(pair[1]);
    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(1);
    expect(pair[0].dispose).not.toHaveBeenCalled();
    expect(pair[1].dispose).not.toHaveBeenCalled();
    // The own tile is re-announced under the new participant id.
    expect(store().ensureJitsiTileParticipantBroadcast).toHaveBeenLastCalledWith("me-2", undefined);
  });

  it("does not publish on rejoin when no own tile is on the stage", async () => {
    mocks.createLocalTracks.mockResolvedValue([fakeTrack("audio"), fakeTrack("video")]);
    const { jitsi, joined } = mountPublisher();
    await flushPromises();
    joined.value = false;
    await flushPromises();
    const newRoom = makeRoom();
    (jitsi as { room: unknown }).room = newRoom;
    joined.value = true;
    await flushPromises();
    expect(newRoom.addTrack).not.toHaveBeenCalled();
  });

  it("gets fresh tracks first when the camera ended while the connection was down", async () => {
    const first = [fakeTrack("audio"), fakeTrack("video")];
    const second = [fakeTrack("audio"), fakeTrack("video")];
    mocks.createLocalTracks.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { jitsi, joined } = mountPublisher();
    await flushPromises();
    store().board.objects = [{ type: "jitsi", participantId: "me", hostId: "sess-1", id: 1 }];
    await flushPromises();

    joined.value = false;
    await flushPromises();
    first[1].ended = true; // laptop slept; OS took the camera away
    const newRoom = makeRoom();
    (jitsi as { room: unknown }).room = newRoom;
    joined.value = true;
    await flushPromises();

    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(2);
    expect(newRoom.addTrack).toHaveBeenCalledTimes(2);
    expect(newRoom.addTrack).toHaveBeenCalledWith(second[0]);
    expect(newRoom.addTrack).toHaveBeenCalledWith(second[1]);
    expect(newRoom.addTrack).not.toHaveBeenCalledWith(first[1]);
  });
});

/**
 * Firefox: re-adding the local tracks to the same conference after an
 * unpublish is unreliable — a renegotiation while they are detached makes
 * Firefox signal `source-remove`, and the later addTrack does not always
 * signal `source-add`, so the bridge discards the performer's media
 * (prod rehearsal 2026-11-21; reproduced 2026-11-23). A re-publish after an
 * unpublish therefore goes through a fresh conference session in Firefox.
 */
describe("useLocalStreamPublisher — Firefox re-publish after taking the stream off stage", () => {
  const ownTile = [{ type: "jitsi", participantId: "me", hostId: "sess-1", id: 1 }];

  async function publishThenUnpublish(firefox: boolean) {
    mocks.browser.firefox = firefox;
    const pair = [fakeTrack("audio"), fakeTrack("video")];
    mocks.createLocalTracks.mockResolvedValue(pair);
    const ctx = mountPublisher();
    const rejoin = vi.fn();
    (ctx.jitsi as unknown as { rejoin: typeof rejoin }).rejoin = rejoin;
    await flushPromises();
    store().board.objects = ownTile;
    await flushPromises();
    expect(ctx.room.addTrack).toHaveBeenCalledTimes(2);
    store().board.objects = [];
    await flushPromises();
    expect(ctx.room.removeTrack).toHaveBeenCalledTimes(2);
    return { ...ctx, rejoin, pair };
  }

  it("Firefox: asks for a fresh session instead of re-adding to the same conference", async () => {
    const { room, rejoin, jitsi, joined, pair } = await publishThenUnpublish(true);
    store().board.objects = ownTile;
    await flushPromises();
    expect(rejoin).toHaveBeenCalledTimes(1);
    expect(room.addTrack).toHaveBeenCalledTimes(2); // nothing re-added to the old conference

    // useJitsi rejoins: new room, joined false -> true; the same tracks are published there.
    joined.value = false;
    await flushPromises();
    const newRoom = makeRoom();
    (jitsi as { room: unknown }).room = newRoom;
    joined.value = true;
    await flushPromises();
    expect(newRoom.addTrack).toHaveBeenCalledTimes(2);
    expect(newRoom.addTrack).toHaveBeenCalledWith(pair[1]);
    expect(mocks.createLocalTracks).toHaveBeenCalledTimes(1);
    expect(rejoin).toHaveBeenCalledTimes(1); // the fresh session publishes directly, no second rejoin
  });

  it("Firefox: a first publish (nothing unpublished yet) does not rejoin", async () => {
    mocks.browser.firefox = true;
    mocks.createLocalTracks.mockResolvedValue([fakeTrack("audio"), fakeTrack("video")]);
    const { jitsi, room } = mountPublisher();
    const rejoin = vi.fn();
    (jitsi as unknown as { rejoin: typeof rejoin }).rejoin = rejoin;
    await flushPromises();
    store().board.objects = ownTile;
    await flushPromises();
    expect(rejoin).not.toHaveBeenCalled();
    expect(room.addTrack).toHaveBeenCalledTimes(2);
  });

  it("Chromium: re-adds to the same conference as before, no rejoin", async () => {
    const { room, rejoin } = await publishThenUnpublish(false);
    store().board.objects = ownTile;
    await flushPromises();
    expect(rejoin).not.toHaveBeenCalled();
    expect(room.addTrack).toHaveBeenCalledTimes(4);
  });

  it("Firefox: Refresh streams on a published stream also goes through a fresh session", async () => {
    mocks.browser.firefox = true;
    mocks.createLocalTracks.mockResolvedValue([fakeTrack("audio"), fakeTrack("video")]);
    const { jitsi, room } = mountPublisher();
    const rejoin = vi.fn();
    (jitsi as unknown as { rejoin: typeof rejoin }).rejoin = rejoin;
    await flushPromises();
    store().board.objects = ownTile;
    await flushPromises();
    (store() as unknown as { forceReloadStreams: Date }).forceReloadStreams = new Date();
    await flushPromises();
    expect(rejoin).toHaveBeenCalledTimes(1);
    expect(room.removeTrack).not.toHaveBeenCalled();
  });
});
