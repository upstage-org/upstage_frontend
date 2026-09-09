// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * The stall watchdog: a WHEP session that negotiates but never advances
 * its decoded-frame counter (OBS-default B-frames) must be torn down and
 * replaced with HLS playback; a healthy session and a deliberately paused
 * tile must be left alone. These tests drive the watchdog with a mocked
 * whepClient and hls.js under fake timers.
 */

const { fakeHlsInstances, FakeHls, framesDecoded, whepClose, connectWhep, pcs } = vi.hoisted(() => {
  const fakeHlsInstances: InstanceType<typeof FakeHls>[] = [];
  class FakeHls {
    static isSupported = () => true;
    handlers: Record<string, (event: string, data: unknown) => void> = {};
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    constructor() {
      fakeHlsInstances.push(this);
    }
    on(event: string, cb: (event: string, data: unknown) => void) {
      this.handlers[event] = cb;
    }
  }
  const framesDecoded = vi.fn(async () => 0);
  const whepClose = vi.fn(async () => {});
  const pcs: Array<{
    connectionState: string;
    handlers: Record<string, () => void>;
    addEventListener: (type: string, cb: () => void) => void;
  }> = [];
  const connectWhep = vi.fn(async (_key: string, _origin?: string) => {
    const pc = {
      connectionState: "connected",
      handlers: {} as Record<string, () => void>,
      addEventListener(type: string, cb: () => void) {
        this.handlers[type] = cb;
      },
    };
    pcs.push(pc);
    return {
      stream: { getTracks: () => [{}], getVideoTracks: () => [{}] },
      pc,
      hasAudio: true,
      close: whepClose,
    };
  });
  return { fakeHlsInstances, FakeHls, framesDecoded, whepClose, connectWhep, pcs };
});

vi.mock("hls.js", () => ({
  default: Object.assign(FakeHls, { Events: { MANIFEST_PARSED: "mp", ERROR: "err" } }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
// The player watches the store's force-reload tick (Refresh streams
// button); a reactive stand-in lets tests fire the signal without Pinia.
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    forceReloadStreams: null as Date | null,
    // Local listening controls read by the player (defaults: audible).
    streamLocalMuted: () => false,
    streamLocalVolume: () => 100,
  });
  return { useStageStore: () => store };
});
import { useStageStore } from "@stores/pinia/stage";
// The real store types `forceReloadStreams` as a readonly computed; the
// mock above is a plain reactive object the tests may write to.
const stageStoreMock = () => useStageStore() as unknown as { forceReloadStreams: Date | null };
// Two configured MediaMTX servers so the per-feed origin routing is
// observable; the default (entry 0) is what legacy feeds resolve to.
vi.mock("config", () => ({
  default: {
    STATIC_ASSETS_ENDPOINT: "/resources/",
    RTMP_ENDPOINT: "https://rtmp1.test",
    RTMP_ENDPOINTS: ["https://rtmp1.test", "https://rtmp2.test"],
    RTMP_SERVER_COUNT: 2,
    JITSI_ENDPOINT: "https://jitsi.test",
    JITSI_ENDPOINTS: ["https://jitsi.test"],
    JITSI_SERVER_COUNT: 1,
  },
}));
vi.mock("./whepClient", () => ({
  connectWhep: (key: string, origin?: string) => connectWhep(key, origin),
  videoFramesDecoded: () => framesDecoded(),
  hlsStreamHasAudio: async () => false,
  hlsUrlForKey: (key: string, origin?: string) =>
    origin === "https://rtmp1.test"
      ? `https://hls.test/live/${key}/index.m3u8`
      : `${origin}/live/${key}/index.m3u8`,
  opusMirrorKey: (key: string) => `${key}-opus`,
  StreamOfflineError: class StreamOfflineError extends Error {},
}));

import LiveStreamPlayer from "./LiveStreamPlayer.vue";

async function mountPlaying(
  playing = true,
  object: Record<string, unknown> = { id: "obj1", fileLocation: "key1" },
) {
  const wrapper = mount(LiveStreamPlayer, {
    props: { object },
  });
  const video = wrapper.find("video").element as HTMLVideoElement;
  // jsdom media elements never actually play; the watchdog only counts
  // time while the element is unpaused, so stub the element state
  // (`playing=false` models a gesture-blocked autoplay attempt).
  Object.defineProperty(video, "paused", { get: () => !playing });
  Object.defineProperty(video, "play", { value: () => undefined });
  Object.defineProperty(video, "pause", { value: () => undefined });
  await vi.advanceTimersByTimeAsync(0); // let connect() settle
  return wrapper;
}

beforeEach(() => {
  vi.useFakeTimers();
  fakeHlsInstances.length = 0;
  pcs.length = 0;
  framesDecoded.mockReset();
  framesDecoded.mockResolvedValue(0);
  whepClose.mockClear();
  connectWhep.mockClear();
  stageStoreMock().forceReloadStreams = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LiveStreamPlayer WHEP stall watchdog", () => {
  it("falls back to HLS when the decoded-frame counter never advances", async () => {
    const wrapper = await mountPlaying();
    expect(connectWhep).toHaveBeenCalledWith("key1-opus", "https://rtmp1.test");

    // 8s of stalled decoding → teardown + HLS.
    await vi.advanceTimersByTimeAsync(8000);
    expect(whepClose).toHaveBeenCalled();
    expect(fakeHlsInstances).toHaveLength(1);
    expect(fakeHlsInstances[0].loadSource).toHaveBeenCalledWith(
      "https://hls.test/live/key1/index.m3u8",
    );

    // Manifest parses → tile is live again.
    fakeHlsInstances[0].handlers["mp"]?.("mp", {});
    await vi.advanceTimersByTimeAsync(0);
    expect(wrapper.find(".live-stream-placeholder").exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps the WHEP session while frames keep decoding", async () => {
    let frames = 0;
    framesDecoded.mockImplementation(async () => (frames += 30));
    const wrapper = await mountPlaying();

    await vi.advanceTimersByTimeAsync(20000);
    expect(whepClose).not.toHaveBeenCalled();
    expect(fakeHlsInstances).toHaveLength(0);
    wrapper.unmount();
  });

  it("reconnects on HLS when the WebRTC session dies before decoding video", async () => {
    const wrapper = await mountPlaying();
    const pc = pcs[pcs.length - 1];
    pc.connectionState = "disconnected";
    pc.handlers["connectionstatechange"]?.();
    await vi.advanceTimersByTimeAsync(50);

    expect(whepClose).toHaveBeenCalled();
    expect(fakeHlsInstances).toHaveLength(1);
    expect(fakeHlsInstances[0].loadSource).toHaveBeenCalledWith(
      "https://hls.test/live/key1/index.m3u8",
    );
    // WHEP was not re-polled — the feed is marked WebRTC-hostile.
    expect(connectWhep).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("re-polls WHEP (no HLS) when a session dies after decoding real video", async () => {
    framesDecoded.mockResolvedValue(300);
    const wrapper = await mountPlaying();
    const pc = pcs[pcs.length - 1];
    pc.connectionState = "disconnected";
    pc.handlers["connectionstatechange"]?.();
    await vi.advanceTimersByTimeAsync(50);
    expect(fakeHlsInstances).toHaveLength(0);

    // The offline retry interval elapses → a fresh WHEP attempt.
    await vi.advanceTimersByTimeAsync(5000);
    expect(connectWhep).toHaveBeenCalledTimes(2);
    expect(fakeHlsInstances).toHaveLength(0);
    wrapper.unmount();
  });

  it("does not count stall time while the element is paused (autoplay blocked)", async () => {
    const wrapper = await mountPlaying(false);

    await vi.advanceTimersByTimeAsync(20000);
    expect(whepClose).not.toHaveBeenCalled();
    expect(fakeHlsInstances).toHaveLength(0);
    wrapper.unmount();
  });

  it("reconnects from scratch — WHEP first again — on the force-reload signal", async () => {
    const wrapper = await mountPlaying();

    // Stall out the WHEP session so the feed is marked WebRTC-hostile and
    // playback lands on HLS.
    await vi.advanceTimersByTimeAsync(8000);
    expect(fakeHlsInstances).toHaveLength(1);
    expect(connectWhep).toHaveBeenCalledTimes(1);

    // Refresh streams button → full teardown, HLS instance destroyed, and
    // the WebRTC-hostile verdict is forgotten: WHEP gets a fresh chance.
    stageStoreMock().forceReloadStreams = new Date();
    await vi.advanceTimersByTimeAsync(50);
    expect(fakeHlsInstances[0].destroy).toHaveBeenCalled();
    expect(connectWhep).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("a healthy WHEP session is re-established (not left alone) on the force-reload signal", async () => {
    framesDecoded.mockResolvedValue(1);
    let frames = 1;
    framesDecoded.mockImplementation(async () => (frames += 30));
    const wrapper = await mountPlaying();
    await vi.advanceTimersByTimeAsync(5000);
    expect(whepClose).not.toHaveBeenCalled();

    // Explicit user click: tear down and reconnect even though frames flow —
    // this is what recovers a "frozen last frame" the watchdog can't see.
    stageStoreMock().forceReloadStreams = new Date();
    await vi.advanceTimersByTimeAsync(50);
    expect(whepClose).toHaveBeenCalledTimes(1);
    expect(connectWhep).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it("does not reconnect when no refresh signal is fired", async () => {
    let frames = 1;
    framesDecoded.mockImplementation(async () => (frames += 30));
    const wrapper = await mountPlaying();
    await vi.advanceTimersByTimeAsync(30000);
    expect(connectWhep).toHaveBeenCalledTimes(1);
    expect(whepClose).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

/**
 * Multi-server streaming: a feed bound to a second MediaMTX (rtmpEndpoint in
 * its asset description) must be played from that origin — WHEP and the HLS
 * fallback alike — while legacy feeds and feeds bound to a server this build
 * no longer lists keep using the default origin.
 */
describe("LiveStreamPlayer per-feed MediaMTX origin", () => {
  it("connects WHEP and HLS to the feed's own server", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await mountPlaying(true, {
      id: "obj2",
      fileLocation: "key2",
      description: JSON.stringify({ isRTMP: true, rtmpEndpoint: "https://rtmp2.test" }),
    });
    expect(connectWhep).toHaveBeenCalledWith("key2-opus", "https://rtmp2.test");
    await vi.advanceTimersByTimeAsync(8000);
    expect(fakeHlsInstances[0].loadSource).toHaveBeenCalledWith(
      "https://rtmp2.test/live/key2/index.m3u8",
    );
  });

  it("uses the default server for legacy feeds without a bound server", async () => {
    await mountPlaying(true, {
      id: "obj3",
      fileLocation: "key3",
      description: JSON.stringify({ isRTMP: true }),
    });
    expect(connectWhep).toHaveBeenCalledWith("key3-opus", "https://rtmp1.test");
  });

  it("falls back to the default server when the bound server is no longer configured", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await mountPlaying(true, {
      id: "obj4",
      fileLocation: "key4",
      description: JSON.stringify({ isRTMP: true, rtmpEndpoint: "https://gone.test" }),
    });
    expect(connectWhep).toHaveBeenCalledWith("key4-opus", "https://rtmp1.test");
  });
});
