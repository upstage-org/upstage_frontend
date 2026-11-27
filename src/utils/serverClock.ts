/**
 * This browser's clock measured against the server's.
 *
 * Someone who joins a stage late is shown multiframe animations at the point
 * they have reached for everyone else (see `FrameRun` in frameAnimation.ts).
 * That needs "how long ago did this animation start": the start is stamped
 * by the server when it archives the event, "now" comes from this computer,
 * and a computer whose clock is a few seconds out would change frame a few
 * seconds early or late. So the difference is measured once per stage load.
 *
 * No server change is needed: every HTTP response carries the server's time
 * in its `Date` header. That header only has whole seconds, so one reading
 * pins the offset to a one-second window; a few readings taken at different
 * points within a second overlap to a much narrower one (typically a few
 * hundred milliseconds, plus network delay). The site's own `version.json`
 * is used — same origin, tiny, and served by the same machine that stamps
 * the archive.
 *
 * Anything going wrong leaves the offset where it was (zero at first):
 * the stage still works, timed by this computer's clock as before.
 */

const SAMPLE_COUNT = 4;
/** Not a divisor of 1000, so successive samples land on different phases. */
const SAMPLE_SPACING_MS = 270;
const SAMPLE_TIMEOUT_MS = 1500;

let offsetMs = 0;
let synced = false;

/** `Date.now()` corrected to the server's clock. */
export const serverNow = (): number => Date.now() + offsetMs;

/** Server clock minus this browser's clock, in ms (0 until measured). */
export const serverClockOffset = (): number => offsetMs;
export const serverClockSynced = (): boolean => synced;

export interface ClockSample {
  /** Browser time just before the request was sent. */
  sentAt: number;
  /** Browser time when the response headers arrived. */
  receivedAt: number;
  /** The response's `Date` header, in ms (whole seconds). */
  serverSecond: number;
}

/**
 * Offset implied by a set of samples, or null when they contradict each
 * other. Each sample says: the server's clock read somewhere within
 * [serverSecond, serverSecond + 1 s) at some moment between sentAt and
 * receivedAt, which bounds the offset from both sides; the answer is the
 * middle of what all samples allow.
 */
export function offsetFromSamples(samples: readonly ClockSample[]): number | null {
  let low = -Infinity;
  let high = Infinity;
  for (const s of samples) {
    low = Math.max(low, s.serverSecond - s.receivedAt);
    high = Math.min(high, s.serverSecond + 1000 - s.sentAt);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return null;
  return Math.round((low + high) / 2);
}

async function takeSample(url: string): Promise<ClockSample | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SAMPLE_TIMEOUT_MS);
  try {
    const sentAt = Date.now();
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    const receivedAt = Date.now();
    const header = response.headers.get("date");
    const serverSecond = header ? Date.parse(header) : NaN;
    if (!Number.isFinite(serverSecond)) return null;
    return { sentAt, receivedAt, serverSecond };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

let inFlight: Promise<void> | null = null;

/**
 * Measure the offset. Resolves when done (about a second); never rejects.
 * Concurrent calls share one measurement.
 */
export function syncServerClock(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      if (typeof fetch !== "function" || typeof location === "undefined") return;
      const url = new URL("/version.json", location.origin).toString();
      const samples: ClockSample[] = [];
      for (let i = 0; i < SAMPLE_COUNT; i += 1) {
        const sample = await takeSample(`${url}?clock=${Date.now()}`);
        // No server time on the first try: give up at once rather than
        // hold the stage load for a server that will not answer.
        if (!sample) break;
        samples.push(sample);
        if (i < SAMPLE_COUNT - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, SAMPLE_SPACING_MS));
        }
      }
      const measured = offsetFromSamples(samples);
      if (measured != null) {
        offsetMs = measured;
        synced = true;
      }
    } catch {
      // keep the previous offset
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test hook. */
export function __setServerClockOffsetForTests(value: number, isSynced = true) {
  offsetMs = value;
  synced = isSynced;
}
