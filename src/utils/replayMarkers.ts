export interface ReplayMarker {
  id: string;
  label: string;
  mqttTimestamp: number;
}

const storageKey = (performanceId: string) => `upstage:replay-markers:${performanceId}`;

export function loadReplayMarkers(performanceId: string): ReplayMarker[] {
  if (!performanceId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(performanceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReplayMarker[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveReplayMarkers(performanceId: string, markers: ReplayMarker[]): void {
  if (!performanceId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(performanceId), JSON.stringify(markers));
  } catch {
    // private mode / quota — ignore
  }
}
