// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * Individual-stream (jitsi) tile: attaches tracks on arrival, stays idempotent
 * on the gentle reload signal (no flicker), and detaches + re-attaches on the
 * explicit force-reload signal from the Refresh streams button.
 */

vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    jitsiTracks: [] as unknown[],
    reloadStreams: null as Date | null,
    forceReloadStreams: null as Date | null,
    canPlay: false,
    streamLocalMuted: () => false,
    streamLocalVolume: () => 100,
    addTrack(track: { getId: () => string }) {
      if (
        !store.jitsiTracks.some((t) => (t as { getId: () => string }).getId() === track.getId())
      ) {
        store.jitsiTracks = [...store.jitsiTracks, track];
      }
    },
  });
  return { useStageStore: () => store };
});
vi.mock("@utils/mediaPlayback", () => ({
  playMediaElement: vi.fn(async () => {}),
  retryPlayOnUserGesture: vi.fn(),
}));
vi.mock("@composables/usePageWakeRecovery", () => ({ usePageWakeRecovery: vi.fn() }));
vi.mock("./useStreamFreezeDetector", async () => {
  const { ref } = await import("vue");
  return { useStreamFreezeDetector: () => ({ frozen: ref(false) }) };
});
vi.mock("./useStreamFreezeReporter", () => ({ useStreamFreezeReporter: vi.fn() }));

import { useStageStore } from "@stores/pinia/stage";
import Jitsi from "./Jitsi.vue";

type StoreMock = {
  jitsiTracks: unknown[];
  reloadStreams: Date | null;
  forceReloadStreams: Date | null;
};
const store = () => useStageStore() as unknown as StoreMock;

// Tracks live in the store's deep `ref` board, so Vue wraps them in reactive
// proxies. A real MediaStream is never proxied (Vue only proxies plain
// Object/Array/Map/Set), so `el.srcObject === track.stream` holds in the
// browser. Mimic that: a plain `{}` WOULD be proxied and break the guard.
class FakeMediaStream {
  active = true;
  id: string;
  constructor(id: string) {
    this.id = id;
  }
  get [Symbol.toStringTag]() {
    return "MediaStream";
  }
}

function fakeTrack(type: "video" | "audio", participantId: string) {
  const stream = new FakeMediaStream(`${type}-${participantId}`);
  const track = {
    type,
    stream,
    getParticipantId: () => participantId,
    getId: () => `${type}-${participantId}`,
    isLocal: () => false,
    attach: vi.fn((el: HTMLMediaElement) => {
      (el as unknown as { srcObject: unknown }).srcObject = stream;
    }),
    detach: vi.fn((el: HTMLMediaElement) => {
      (el as unknown as { srcObject: unknown }).srcObject = null;
    }),
  };
  return track;
}

const mounted: Array<{ unmount: () => void }> = [];
function mountTile(participantId = "p1", room: unknown = null) {
  const w = mount(Jitsi, {
    props: { object: { id: "o1", type: "jitsi", participantId }, closeMenu: () => {} },
    global: {
      mocks: { $t: (k: string) => k },
      provide: { jitsi: { room, localTracks: { value: [] } } },
      stubs: {
        AppObject: { template: "<div><slot name='render' /></div>" },
        Loading: true,
        StreamContextMenu: true,
      },
    },
  });
  mounted.push(w);
  return w;
}

beforeEach(() => {
  vi.useFakeTimers();
  store().jitsiTracks = [];
  store().reloadStreams = null;
  store().forceReloadStreams = null;
});
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
});

describe("Jitsi tile attach", () => {
  it("shows the loading spinner while no track for its participant exists", () => {
    const w = mountTile();
    expect(w.find(".loading").exists()).toBe(true);
    expect(w.find("video").exists()).toBe(false);
  });

  it("ignores tracks belonging to other participants", async () => {
    store().jitsiTracks = [fakeTrack("video", "someone-else")];
    const w = mountTile();
    await flushPromises();
    expect(w.find("video").exists()).toBe(false);
  });

  it("attaches video + audio when the participant's tracks arrive", async () => {
    const w = mountTile();
    const v = fakeTrack("video", "p1");
    const a = fakeTrack("audio", "p1");
    store().jitsiTracks = [v, a];
    await flushPromises();
    expect(w.find("video").exists()).toBe(true);
    expect(v.attach).toHaveBeenCalledTimes(1);
    expect(a.attach).toHaveBeenCalledTimes(1);
  });

  it("gentle reload signal does not re-attach an already attached track (no flicker)", async () => {
    mountTile();
    const v = fakeTrack("video", "p1");
    store().jitsiTracks = [v];
    await flushPromises();
    expect(v.attach).toHaveBeenCalledTimes(1);
    store().reloadStreams = new Date();
    await nextTick();
    expect(v.attach).toHaveBeenCalledTimes(1);
    expect(v.detach).not.toHaveBeenCalled();
  });

  it("3s poll does not re-attach an already attached track", async () => {
    mountTile();
    const v = fakeTrack("video", "p1");
    store().jitsiTracks = [v];
    await flushPromises();
    await vi.advanceTimersByTimeAsync(9000);
    expect(v.attach).toHaveBeenCalledTimes(1);
  });
});

describe("Jitsi tile force reload (Refresh streams button)", () => {
  it("detaches then re-attaches video and audio even though they look healthy", async () => {
    mountTile();
    const v = fakeTrack("video", "p1");
    const a = fakeTrack("audio", "p1");
    store().jitsiTracks = [v, a];
    await flushPromises();
    store().forceReloadStreams = new Date();
    await nextTick();
    expect(v.detach).toHaveBeenCalledTimes(1);
    expect(v.attach).toHaveBeenCalledTimes(2);
    expect(a.detach).toHaveBeenCalledTimes(1);
    expect(a.attach).toHaveBeenCalledTimes(2);
  });

  it("does not detach a local audio track (own tile would echo / lose publish)", async () => {
    mountTile();
    const v = fakeTrack("video", "p1");
    const a = fakeTrack("audio", "p1");
    a.isLocal = () => true;
    store().jitsiTracks = [v, a];
    await flushPromises();
    store().forceReloadStreams = new Date();
    await nextTick();
    expect(v.attach).toHaveBeenCalledTimes(2);
    expect(a.attach).not.toHaveBeenCalled();
    expect(a.detach).not.toHaveBeenCalled();
  });

  it("is a no-op when the tile has no tracks yet", async () => {
    const w = mountTile();
    store().forceReloadStreams = new Date();
    await nextTick();
    expect(w.find(".loading").exists()).toBe(true);
  });

  it("survives a detach that throws and still re-attaches", async () => {
    mountTile();
    const v = fakeTrack("video", "p1");
    v.detach.mockImplementation(() => {
      throw new Error("boom");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    store().jitsiTracks = [v];
    await flushPromises();
    store().forceReloadStreams = new Date();
    await nextTick();
    expect(warn).toHaveBeenCalled();
    expect(v.attach).toHaveBeenCalledTimes(2);
  });
});

/**
 * A performer takes her stream off the stage and puts it back (prod,
 * 2026-11-21 rehearsal and reproduced 2026-11-23): lib-jitsi-meet keeps her
 * remote track objects and never fires a second TRACK_ADDED, while the store
 * dropped them with the old tile — so the new tile had nothing to attach.
 * The tile now asks the conference for the participant's live tracks.
 */
describe("Jitsi tile recovers tracks the store dropped but the conference still has", () => {
  const roomWith = (tracksByParticipant: Record<string, unknown[]>) => ({
    myUserId: () => "me",
    getLocalTracks: () => [],
    getParticipantById: (id: string) =>
      tracksByParticipant[id] ? { getTracks: () => tracksByParticipant[id] } : undefined,
  });

  it("attaches the conference's tracks when the store has none for the participant", async () => {
    const video = fakeTrack("video", "p1");
    const audio = fakeTrack("audio", "p1");
    const w = mountTile("p1", roomWith({ p1: [audio, video] }));
    await flushPromises();
    await nextTick();
    expect(store().jitsiTracks).toHaveLength(2);
    expect(w.find(".loading").exists()).toBe(false);
    expect(video.attach).toHaveBeenCalledTimes(1);
  });

  it("picks the tracks up on a later poll once the performer has re-published", async () => {
    const live: Record<string, unknown[]> = {};
    const w = mountTile("p1", roomWith(live));
    await flushPromises();
    expect(w.find(".loading").exists()).toBe(true);
    const video = fakeTrack("video", "p1");
    live.p1 = [video];
    await vi.advanceTimersByTimeAsync(3000);
    await nextTick();
    expect(store().jitsiTracks).toHaveLength(1);
    expect(video.attach).toHaveBeenCalledTimes(1);
  });

  it("never adds another participant's tracks, disposed tracks, or duplicates", async () => {
    const mine = fakeTrack("video", "p1");
    const dead = { ...fakeTrack("audio", "p1"), disposed: true };
    const other = fakeTrack("video", "p2");
    store().jitsiTracks = [mine];
    mountTile("p1", roomWith({ p1: [mine, dead], p2: [other] }));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(9000);
    expect(store().jitsiTracks).toEqual([mine]);
  });

  it("does nothing for the performer's own tile or before the conference exists", async () => {
    const room = { ...roomWith({ me: [fakeTrack("video", "me")] }), myUserId: () => "me" };
    mountTile("me", room);
    mountTile("p1", null);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(6000);
    expect(store().jitsiTracks).toHaveLength(0);
  });
});
