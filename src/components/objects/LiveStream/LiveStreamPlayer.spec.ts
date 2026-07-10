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
  const connectWhep = vi.fn(async (_key: string) => {
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
vi.mock("./whepClient", () => ({
  connectWhep: (key: string) => connectWhep(key),
  videoFramesDecoded: () => framesDecoded(),
  hlsStreamHasAudio: async () => false,
  hlsUrlForKey: (key: string) => `https://hls.test/live/${key}/index.m3u8`,
  opusMirrorKey: (key: string) => `${key}-opus`,
  StreamOfflineError: class StreamOfflineError extends Error {},
}));

import LiveStreamPlayer from "./LiveStreamPlayer.vue";

async function mountPlaying(isPlaying = true) {
  const wrapper = mount(LiveStreamPlayer, {
    props: { object: { id: "obj1", fileLocation: "key1", isPlaying } },
  });
  const video = wrapper.find("video").element as HTMLVideoElement;
  // jsdom media elements never actually play; the watchdog only counts
  // time while the element is unpaused, so mirror isPlaying here.
  Object.defineProperty(video, "paused", { get: () => !isPlaying });
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
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LiveStreamPlayer WHEP stall watchdog", () => {
  it("falls back to HLS when the decoded-frame counter never advances", async () => {
    const wrapper = await mountPlaying();
    expect(connectWhep).toHaveBeenCalledWith("key1-opus");

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

  it("does not count stall time while the tile is paused (Play tool off)", async () => {
    const wrapper = await mountPlaying(false);

    await vi.advanceTimersByTimeAsync(20000);
    expect(whepClose).not.toHaveBeenCalled();
    expect(fakeHlsInstances).toHaveLength(0);
    wrapper.unmount();
  });
});
