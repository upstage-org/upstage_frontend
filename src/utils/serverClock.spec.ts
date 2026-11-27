// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setServerClockOffsetForTests,
  offsetFromSamples,
  serverClockOffset,
  serverClockSynced,
  serverNow,
  syncServerClock,
} from "./serverClock";

/**
 * The browser-vs-server clock offset used to place a late joiner inside an
 * animation that started before they arrived (#1582). Measured from the
 * whole-second `Date` header of a few same-origin responses.
 */

describe("offsetFromSamples", () => {
  // Truth for these: the server clock is `offset` ahead of the browser's.
  const sample = (browserNow: number, offset: number, rtt = 20) => ({
    sentAt: browserNow - rtt / 2,
    receivedAt: browserNow + rtt / 2,
    serverSecond: Math.floor((browserNow + offset) / 1000) * 1000,
  });

  it("one sample is right to within the header's one second", () => {
    const got = offsetFromSamples([sample(1_000_000_300, 4_200)])!;
    expect(Math.abs(got - 4_200)).toBeLessThanOrEqual(520);
  });

  it("samples at different points in the second narrow it down", () => {
    for (const offset of [0, 137, -2_750, 4_200, 86_400_123, -999]) {
      const t0 = 1_700_000_000_123;
      const samples = [0, 270, 540, 810].map((d) => sample(t0 + d, offset));
      const got = offsetFromSamples(samples)!;
      expect(Math.abs(got - offset), `offset ${offset}`).toBeLessThanOrEqual(150);
    }
  });

  it("never claims more than the samples allow, whatever the phase", () => {
    for (let phase = 0; phase < 1000; phase += 37) {
      const samples = [0, 270, 540, 810].map((d) => sample(5_000_000 + phase + d, 3_333));
      expect(Math.abs(offsetFromSamples(samples)! - 3_333)).toBeLessThanOrEqual(150);
    }
  });

  it("returns null for no samples or samples that contradict each other", () => {
    expect(offsetFromSamples([])).toBeNull();
    expect(
      offsetFromSamples([
        { sentAt: 0, receivedAt: 10, serverSecond: 0 },
        { sentAt: 100, receivedAt: 110, serverSecond: 60_000 },
      ]),
    ).toBeNull();
  });
});

describe("syncServerClock", () => {
  const SERVER_AHEAD = 7_400;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_250);
    __setServerClockOffsetForTests(0, false);
    fetchMock = vi.fn(async () => {
      const serverMs = Date.now() + SERVER_AHEAD;
      return new Response(null, {
        headers: { date: new Date(Math.floor(serverMs / 1000) * 1000).toUTCString() },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    __setServerClockOffsetForTests(0, false);
  });

  it("measures the offset from the Date header of same-origin requests", async () => {
    const done = syncServerClock();
    await vi.advanceTimersByTimeAsync(2_000);
    await done;
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).origin).toBe(location.origin);
    expect(new URL(url).pathname).toBe("/version.json");
    expect(init.method).toBe("HEAD");
    expect(init.cache).toBe("no-store");
    expect(serverClockSynced()).toBe(true);
    expect(Math.abs(serverClockOffset() - SERVER_AHEAD)).toBeLessThanOrEqual(150);
    expect(Math.abs(serverNow() - (Date.now() + SERVER_AHEAD))).toBeLessThanOrEqual(150);
  });

  it("concurrent calls share one measurement", async () => {
    const a = syncServerClock();
    const b = syncServerClock();
    expect(a).toBe(b);
    await vi.advanceTimersByTimeAsync(2_000);
    await a;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("gives up at once, leaving the offset alone, when the server does not answer", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));
    await syncServerClock();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(serverClockSynced()).toBe(false);
    expect(serverNow()).toBe(Date.now());
  });

  it("ignores a response without a usable Date header", async () => {
    fetchMock.mockResolvedValue(new Response(null));
    await syncServerClock();
    expect(serverClockSynced()).toBe(false);
    expect(serverClockOffset()).toBe(0);
  });

  it("keeps the last good offset when a later measurement fails", async () => {
    const first = syncServerClock();
    await vi.advanceTimersByTimeAsync(2_000);
    await first;
    const good = serverClockOffset();
    fetchMock.mockRejectedValue(new TypeError("network"));
    await syncServerClock();
    expect(serverClockOffset()).toBe(good);
    expect(serverClockSynced()).toBe(true);
  });
});
