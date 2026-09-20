import { describe, expect, it, vi } from "vitest";
import {
  GAPLESS_MAX_DURATION_S,
  LOOP_TRIM_MAX_S,
  createGaplessLooper,
  findLoopBounds,
  loopPosition,
} from "./gaplessLoop";

/**
 * Gapless audio loop (reported 2026-09: "when an audio file is looped, there
 * is a split second of silence when it finishes & starts again").
 *
 * Measured in Chromium: every <audio>-element loop leaves a hole (1–13 ms
 * WAV, 31–34 ms MP3); a looping AudioBufferSourceNode leaves none, provided
 * the codec's padding at both ends of the decoded stream is kept out of the
 * loop region. These tests pin the trimming maths and the engine's
 * "best effort, never in the way" contract.
 */

const RATE = 1000; // 1 frame = 1 ms keeps the numbers readable

/** `head` quiet frames, then `body` loud frames, then `tail` quiet frames. */
const padded = (head: number, body: number, tail: number, quiet = 0) =>
  Float32Array.from([
    ...Array(head).fill(quiet),
    ...Array(body).fill(0.5),
    ...Array(tail).fill(quiet),
  ]);

describe("findLoopBounds", () => {
  it("uses the whole buffer when there is no padding (WAV)", () => {
    expect(findLoopBounds([padded(0, 3000, 0)], RATE)).toEqual({ start: 0, end: 3 });
  });

  it("trims digital silence at both ends (codec delay + padding)", () => {
    expect(findLoopBounds([padded(25, 3000, 5)], RATE)).toEqual({ start: 0.025, end: 3.025 });
  });

  it("treats low-level decoder pre-echo (≈1e-3, as measured on MP3) as padding", () => {
    expect(findLoopBounds([padded(25, 3000, 5, 0.0013)], RATE)).toEqual({
      start: 0.025,
      end: 3.025,
    });
  });

  it("does not treat quiet-but-real audio as padding", () => {
    expect(findLoopBounds([padded(25, 3000, 5, 0.02)], RATE)).toEqual({ start: 0, end: 3.03 });
  });

  it("never trims more than LOOP_TRIM_MAX_S per end — longer silence is the author's", () => {
    const bounds = findLoopBounds([padded(500, 3000, 400)], RATE);
    expect(bounds.start).toBeCloseTo(LOOP_TRIM_MAX_S);
    expect(bounds.end).toBeCloseTo(3.9 - LOOP_TRIM_MAX_S);
  });

  it("only trims frames that are silent on every channel", () => {
    const left = padded(30, 3000, 0);
    const right = padded(10, 3020, 0);
    expect(findLoopBounds([left, right], RATE).start).toBeCloseTo(0.01);
  });

  it("leaves an entirely silent file alone", () => {
    expect(findLoopBounds([new Float32Array(2000)], RATE)).toEqual({ start: 0, end: 2 });
  });

  it("copes with empty input", () => {
    expect(findLoopBounds([], RATE)).toEqual({ start: 0, end: 0 });
    expect(findLoopBounds([new Float32Array(0)], RATE)).toEqual({ start: 0, end: 0 });
  });
});

describe("loopPosition", () => {
  const bounds = { start: 0.025, end: 3.025 };
  it("runs straight from the start offset on the first pass", () => {
    expect(loopPosition(1, 0.5, 1, bounds)).toBeCloseTo(1.5);
  });
  it("wraps inside the loop region on later passes", () => {
    expect(loopPosition(0.025, 3, 1, bounds)).toBeCloseTo(0.025);
    expect(loopPosition(0.025, 7.5, 1, bounds)).toBeCloseTo(1.525);
  });
  it("honours the playback rate (replay speed)", () => {
    expect(loopPosition(0.025, 1, 2, bounds)).toBeCloseTo(2.025);
  });
});

/** Minimal Web Audio stand-in recording what the engine asks of it. */
const makeFakeContext = (frames = padded(25, 3000, 5), state = "running") => {
  const nodes: Record<string, unknown>[] = [];
  const listeners: Record<string, (() => void)[]> = {};
  const ctx = {
    state,
    currentTime: 100,
    destination: { kind: "destination" },
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
    emit: (type: string) => (listeners[type] ?? []).forEach((fn) => fn()),
    decodeAudioData: vi.fn(async () => ({
      duration: frames.length / RATE,
      sampleRate: RATE,
      numberOfChannels: 1,
      getChannelData: () => frames,
    })),
    createBufferSource: () => {
      const node = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      nodes.push(node);
      return node;
    },
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
  };
  return { ctx, nodes };
};

const makeLooper = (fake = makeFakeContext(), extra = {}) => {
  const fetchArrayBuffer = vi.fn(async () => new ArrayBuffer(8));
  const looper = createGaplessLooper({
    createContext: () => fake.ctx as unknown as AudioContext,
    fetchArrayBuffer,
    ...extra,
  });
  return { looper, fetchArrayBuffer, ...fake };
};

describe("createGaplessLooper", () => {
  const SRC = "/resources/audio/drone.mp3";
  const el = {};

  it("decodes once and loops the trimmed region sample-accurately", async () => {
    const { looper, fetchArrayBuffer, nodes } = makeLooper();
    await Promise.all([looper.prepare(SRC, 3.03), looper.prepare(SRC, 3.03)]);
    await looper.prepare(SRC, 3.03);
    expect(fetchArrayBuffer).toHaveBeenCalledTimes(1);
    expect(looper.isReady(SRC)).toBe(true);

    expect(looper.start(el, SRC, { offset: 1.2, volume: 0.4, rate: 1 })).toBe(true);
    const node = nodes[0] as {
      loop: boolean;
      loopStart: number;
      loopEnd: number;
      start: ReturnType<typeof vi.fn>;
    };
    expect(node.loop).toBe(true);
    expect(node.loopStart).toBeCloseTo(0.025);
    expect(node.loopEnd).toBeCloseTo(3.025);
    expect(node.start).toHaveBeenCalledWith(0, 1.2);
    expect(looper.isActive(el)).toBe(true);
  });

  it("starts at the loop start when the offset falls in the padding or past the end", async () => {
    const { looper, nodes } = makeLooper();
    await looper.prepare(SRC);
    looper.start(el, SRC, { offset: 0 });
    looper.start(el, SRC, { offset: 3.03 });
    const starts = nodes.map(
      (n) => (n as { start: ReturnType<typeof vi.fn> }).start.mock.calls[0][1],
    );
    expect(starts[0]).toBeCloseTo(0.025);
    expect(starts[1]).toBeCloseTo(0.025);
  });

  it("restarting replaces the previous voice instead of layering a second one", async () => {
    const { looper, nodes } = makeLooper();
    await looper.prepare(SRC);
    looper.start(el, SRC, { offset: 1 });
    looper.start(el, SRC, { offset: 2 });
    expect((nodes[0] as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalledTimes(1);
    expect((nodes[1] as { stop: ReturnType<typeof vi.fn> }).stop).not.toHaveBeenCalled();
  });

  it("reports the voice position, wrapped into the loop region", async () => {
    const { looper, ctx } = makeLooper();
    await looper.prepare(SRC);
    looper.start(el, SRC, { offset: 1 });
    ctx.currentTime += 3; // one full 3 s pass later
    expect(looper.position(el)).toBeCloseTo(1);
    looper.stop(el);
    expect(looper.position(el)).toBeNull();
    expect(looper.isActive(el)).toBe(false);
  });

  it("refuses to start — and says so — while the context is not running", async () => {
    const fake = makeFakeContext(undefined, "suspended");
    const { looper, nodes } = makeLooper(fake);
    await looper.prepare(SRC);
    expect(looper.start(el, SRC, { offset: 0 })).toBe(false);
    expect(nodes).toHaveLength(0);
    expect(fake.ctx.resume).toHaveBeenCalled();
  });

  it("is simply unavailable without Web Audio, before decoding, or after a decode failure", async () => {
    const none = createGaplessLooper({ createContext: () => null });
    await none.prepare(SRC);
    expect(none.isReady(SRC)).toBe(false);
    expect(none.start(el, SRC)).toBe(false);

    const { looper } = makeLooper();
    expect(looper.start(el, SRC)).toBe(false); // not prepared yet

    const broken = makeFakeContext();
    broken.ctx.decodeAudioData.mockRejectedValue(new Error("EncodingError"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = makeLooper(broken);
    await expect(failing.looper.prepare(SRC)).resolves.toBeUndefined();
    await failing.looper.prepare(SRC); // not retried
    expect(failing.fetchArrayBuffer).toHaveBeenCalledTimes(1);
    expect(failing.looper.start(el, SRC)).toBe(false);
    warn.mockRestore();
  });

  it("does not download tracks that are too long to hold decoded", async () => {
    const { looper, fetchArrayBuffer } = makeLooper();
    await looper.prepare(SRC, GAPLESS_MAX_DURATION_S + 1);
    await looper.prepare(SRC, NaN);
    expect(fetchArrayBuffer).not.toHaveBeenCalled();
  });

  it("mirrors volume and rate changes onto the running voice", async () => {
    const { looper, nodes, ctx } = makeLooper();
    await looper.prepare(SRC);
    looper.start(el, SRC, { offset: 1, volume: 1, rate: 1 });
    looper.setVolume(el, 0.25);
    ctx.currentTime += 1;
    looper.setRate(el, 2);
    ctx.currentTime += 0.5;
    const node = nodes[0] as { playbackRate: { value: number } };
    expect(node.playbackRate.value).toBe(2);
    // 1 s at 1x then 0.5 s at 2x from 1.0 → 3.0
    expect(looper.position(el)).toBeCloseTo(3.0);
    // No voice → no-ops, no throw.
    looper.setVolume({}, 0.5);
    looper.setRate({}, 2);
  });

  it("hands the sound back when the browser suspends the context", async () => {
    const onLost = vi.fn();
    const { looper, ctx } = makeLooper(makeFakeContext(), { onLost });
    await looper.prepare(SRC);
    looper.start(el, SRC);
    ctx.state = "suspended";
    ctx.emit("statechange");
    expect(onLost).toHaveBeenCalledWith(el);
    expect(looper.isActive(el)).toBe(false);
  });

  it("dispose stops every voice and closes the context", async () => {
    const { looper, ctx, nodes } = makeLooper();
    await looper.prepare(SRC);
    looper.start(el, SRC);
    looper.dispose();
    expect((nodes[0] as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
    expect(looper.isActive(el)).toBe(false);
  });
});
