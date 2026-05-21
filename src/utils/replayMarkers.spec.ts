import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadReplayMarkers, saveReplayMarkers, type ReplayMarker } from "./replayMarkers";

describe("replayMarkers", () => {
  const perfId = "test-perf-99";

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("round-trips markers for a performance", () => {
    const markers: ReplayMarker[] = [
      { id: "m1", label: "Intro", mqttTimestamp: 100 },
      { id: "m2", label: "Scene 2", mqttTimestamp: 500 },
    ];
    saveReplayMarkers(perfId, markers);
    expect(loadReplayMarkers(perfId)).toEqual(markers);
  });

  it("returns empty list when storage is missing or invalid", () => {
    expect(loadReplayMarkers(perfId)).toEqual([]);
    window.localStorage.setItem(`upstage:replay-markers:${perfId}`, "not-json");
    expect(loadReplayMarkers(perfId)).toEqual([]);
  });
});
