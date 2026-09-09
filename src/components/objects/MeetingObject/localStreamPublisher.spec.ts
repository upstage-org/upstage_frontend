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
  const JitsiMeetJS = {
    createLocalTracks,
    events: { mediaDevices: { DEVICE_LIST_CHANGED: "devicelistchanged" } },
    mediaDevices: {
      addEventListener: (_ev: string, cb: () => void) => {
        deviceListeners.push(cb);
      },
      removeEventListener: () => {},
    },
  };
  return { JitsiMeetJS, createLocalTracks, deviceListeners };
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
