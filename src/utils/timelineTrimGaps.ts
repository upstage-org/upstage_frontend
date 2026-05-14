/**
 * Compression for a sorted list of timestamps (milliseconds).
 * Each gap longer than `minPauseMs` is shortened so only `minPauseMs` remains.
 */
export function compressSortedTimesMs(times: number[], minPauseMs: number): number[] {
  if (minPauseMs < 0) {
    throw new Error("minPauseMs must be non-negative");
  }
  if (times.length === 0) {
    return [];
  }
  const out: number[] = [times[0]!];
  let removal = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!;
    if (gap > minPauseMs) {
      removal += gap - minPauseMs;
    }
    out.push(times[i]! - removal);
  }
  return out;
}
