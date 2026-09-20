/**
 * Gapless looping for stage audio.
 *
 * An `<audio>` element cannot loop without a hole: restarting it on `ended`
 * and the native `loop` attribute both flush and re-prime the media pipeline.
 * Measured in Chromium 2026-09-21 with a continuous 220 Hz tone: 1–13 ms of
 * silence at every pass for WAV (either technique), 31–34 ms for MP3, where
 * the encoder's delay/padding (silent frames at both ends of the decoded
 * stream) adds to it. On a sustained sound — and louder through a theatre PA
 * — that is an audible tick every time round. A decoded `AudioBuffer` played
 * by an `AudioBufferSourceNode` with `loop = true` wraps sample-accurately
 * (0 ms measured), and `loopStart`/`loopEnd` let us skip the codec padding.
 *
 * This module only produces the SOUND of a looping track. The `<audio>`
 * element in AudioPlayer.vue remains the transport and the clock (play,
 * pause, seek, `timeupdate`, volume fades, replay speed): while a voice is
 * active the element keeps running muted, and the voice mirrors its volume
 * and rate. Everything here is best effort — no Web Audio, a context the
 * browser will not start, a fetch/decode failure or an over-long file all
 * just mean "not available", and the caller keeps today's element loop.
 */

/**
 * Samples quieter than this (≈ -50 dBFS) count as silence when trimming.
 * Codec padding is not exact zeros: a decoded MP3 starts with ~17 ms of
 * decoder pre-echo at 1e-4…1.3e-3 before the first real sample (measured on
 * a LAME file in Chromium), which a stricter threshold left in the loop as
 * an audible ~10 ms hole.
 */
export const LOOP_TRIM_THRESHOLD = 3e-3;
/**
 * Never trim more than this from either end. Codec delay/padding is ~25–50 ms
 * (MP3) or ~45–70 ms (AAC); anything longer is the author's own silence and
 * stays part of the loop.
 */
export const LOOP_TRIM_MAX_S = 0.1;
/** Decoded PCM is ~11.5 MB per stereo minute at 48 kHz; longer tracks keep the element loop. */
export const GAPLESS_MAX_DURATION_S = 600;

export type LoopBounds = { start: number; end: number };

/**
 * Loop region (seconds) of decoded audio with leading/trailing digital
 * silence — codec padding — removed, capped at `maxTrimSeconds` per end.
 * A frame is silent only if it is silent on every channel.
 */
export function findLoopBounds(
  channels: ArrayLike<number>[],
  sampleRate: number,
  threshold = LOOP_TRIM_THRESHOLD,
  maxTrimSeconds = LOOP_TRIM_MAX_S,
): LoopBounds {
  const frames = channels.length ? channels[0].length : 0;
  if (!frames || !(sampleRate > 0)) return { start: 0, end: 0 };
  const duration = frames / sampleRate;
  const maxTrim = Math.min(Math.floor(maxTrimSeconds * sampleRate), Math.floor(frames / 4));
  const silentAt = (i: number) => channels.every((c) => Math.abs(c[i]) < threshold);
  let head = 0;
  while (head < maxTrim && silentAt(head)) head++;
  let tail = 0;
  while (tail < maxTrim && silentAt(frames - 1 - tail)) tail++;
  // An entirely (near-)silent file: nothing meaningful to trim.
  if (head === maxTrim && tail === maxTrim && silentAt(Math.floor(frames / 2))) {
    return { start: 0, end: duration };
  }
  return { start: head / sampleRate, end: (frames - tail) / sampleRate };
}

/**
 * Where a looping voice is within the file, `elapsed` seconds of context
 * time after it was started at `offset` with playback `rate`.
 */
export function loopPosition(
  offset: number,
  elapsed: number,
  rate: number,
  bounds: LoopBounds,
): number {
  const length = bounds.end - bounds.start;
  const travelled = offset + Math.max(0, elapsed) * rate;
  if (!(length > 0) || travelled < bounds.end) return travelled;
  return bounds.start + ((travelled - bounds.start) % length);
}

type Voice = {
  src: string;
  node: AudioBufferSourceNode;
  gain: GainNode;
  startedAt: number;
  offset: number;
  rate: number;
};
type Decoded = { buffer: AudioBuffer; bounds: LoopBounds };

export type GaplessLooper = ReturnType<typeof createGaplessLooper>;

export function createGaplessLooper(
  deps: {
    createContext?: () => AudioContext | null;
    fetchArrayBuffer?: (src: string) => Promise<ArrayBuffer>;
    /**
     * A sounding voice was cut off because the browser suspended/closed the
     * audio context; the caller must let the element be heard again.
     */
    onLost?: (key: object) => void;
  } = {},
) {
  const createContext =
    deps.createContext ??
    (() => {
      const Ctor =
        typeof window !== "undefined"
          ? (window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
          : undefined;
      return Ctor ? new Ctor() : null;
    });
  const fetchArrayBuffer =
    deps.fetchArrayBuffer ??
    (async (src: string) => {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    });

  let ctx: AudioContext | null | undefined;
  const context = () => {
    if (ctx === undefined) {
      try {
        ctx = createContext();
      } catch {
        ctx = null;
      }
      const created = ctx;
      created?.addEventListener?.("statechange", () => {
        if (created !== ctx || created.state === "running") return;
        Array.from(voices.keys()).forEach((key) => {
          stop(key);
          deps.onLost?.(key);
        });
      });
    }
    return ctx;
  };

  const decoded = new Map<string, Decoded>();
  const pending = new Map<string, Promise<void>>();
  const failed = new Set<string>();
  const voices = new Map<object, Voice>();

  /** Fetch + decode `src` once. Never rejects; failures just leave it unavailable. */
  const prepare = (src: string, duration?: number): Promise<void> => {
    if (!src || decoded.has(src) || failed.has(src)) return Promise.resolve();
    if (duration !== undefined && !(duration > 0 && duration <= GAPLESS_MAX_DURATION_S)) {
      return Promise.resolve();
    }
    const running = pending.get(src);
    if (running) return running;
    const audioContext = context();
    if (!audioContext) return Promise.resolve();
    const job = (async () => {
      try {
        const buffer = await audioContext.decodeAudioData(await fetchArrayBuffer(src));
        if (buffer.duration > GAPLESS_MAX_DURATION_S) throw new Error("too long");
        const channels: Float32Array[] = [];
        for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
        const bounds = findLoopBounds(channels, buffer.sampleRate);
        if (!(bounds.end > bounds.start)) throw new Error("empty");
        decoded.set(src, { buffer, bounds });
      } catch (error) {
        failed.add(src);
        console.warn(`[audio] gapless loop unavailable for ${src}; using the element loop`, error);
      } finally {
        pending.delete(src);
      }
    })();
    pending.set(src, job);
    return job;
  };

  const isReady = (src: string) => decoded.has(src);
  const isActive = (key: object) => voices.has(key);

  const stop = (key: object) => {
    const voice = voices.get(key);
    if (!voice) return;
    voices.delete(key);
    try {
      voice.node.stop();
    } catch {
      /* already stopped */
    }
    voice.node.disconnect();
    voice.gain.disconnect();
  };

  /**
   * Start (or restart) the looping voice for `key` at `offset` seconds.
   * Returns false — and changes nothing — when it cannot sound right now.
   */
  const start = (
    key: object,
    src: string,
    { offset = 0, volume = 1, rate = 1 }: { offset?: number; volume?: number; rate?: number } = {},
  ): boolean => {
    const entry = decoded.get(src);
    const audioContext = context();
    if (!entry || !audioContext) return false;
    if (audioContext.state !== "running") {
      // Ask for next time (needs a prior user gesture); do not wait for it.
      audioContext.resume?.().catch(() => {});
      return false;
    }
    stop(key);
    const { buffer, bounds } = entry;
    const node = audioContext.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.loopStart = bounds.start;
    node.loopEnd = bounds.end;
    node.playbackRate.value = rate;
    const gain = audioContext.createGain();
    gain.gain.value = volume;
    node.connect(gain);
    gain.connect(audioContext.destination);
    const from =
      Number.isFinite(offset) && offset > bounds.start && offset < bounds.end
        ? offset
        : bounds.start;
    node.start(0, from);
    voices.set(key, { src, node, gain, startedAt: audioContext.currentTime, offset: from, rate });
    return true;
  };

  const setVolume = (key: object, volume: number) => {
    const voice = voices.get(key);
    if (voice) voice.gain.gain.value = volume;
  };

  const setRate = (key: object, rate: number) => {
    const voice = voices.get(key);
    const audioContext = context();
    if (!voice || !audioContext || !(rate > 0) || rate === voice.rate) return;
    // Re-base so `position()` stays continuous across the rate change.
    voice.offset = position(key) ?? voice.offset;
    voice.startedAt = audioContext.currentTime;
    voice.rate = rate;
    voice.node.playbackRate.value = rate;
  };

  /** Current position (seconds into the file) of the voice, or null when inactive. */
  function position(key: object): number | null {
    const voice = voices.get(key);
    const audioContext = context();
    const entry = voice && decoded.get(voice.src);
    if (!voice || !audioContext || !entry) return null;
    return loopPosition(
      voice.offset,
      audioContext.currentTime - voice.startedAt,
      voice.rate,
      entry.bounds,
    );
  }

  const dispose = () => {
    Array.from(voices.keys()).forEach(stop);
    decoded.clear();
    failed.clear();
    const audioContext = ctx;
    ctx = undefined;
    audioContext?.close?.().catch(() => {});
  };

  return { prepare, isReady, isActive, start, stop, setVolume, setRate, position, dispose };
}
