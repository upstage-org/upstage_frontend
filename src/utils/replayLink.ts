/** Build the canonical replay URL for a stage slug and performance id. */
export function replayUrl(fileLocation: string, performanceId: string | number): string {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/replay/${encodeURIComponent(fileLocation)}/${encodeURIComponent(String(performanceId))}`;
}

export async function copyReplayLink(
  fileLocation: string,
  performanceId: string | number,
): Promise<string> {
  const url = replayUrl(fileLocation, performanceId);
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
  }
  return url;
}
