import { describe, expect, it, vi } from "vitest";

// `unnamespaceTopic` reaches into the Pinia stage store for the namespace/url
// prefix; for these pure reconcile tests we only care that a "board" topic is
// recognised, so stub it to the identity.
vi.mock("@utils/mqttTopics", () => ({
  unnamespaceTopic: (t: string | null | undefined) => t ?? "",
}));

import { computeFinalJitsiObjectsFromEvents } from "./jitsiBoardReconcile";
import { BOARD_ACTIONS } from "@utils/constants";
import type { ReplayEvent } from "@stores/pinia/stage";

let seq = 0;
function evt(type: string, object: Record<string, unknown>, ts = ++seq): ReplayEvent {
  return {
    id: `e${seq}`,
    mqttTimestamp: ts,
    topic: "board",
    payload: JSON.stringify({ type, object }),
  } as ReplayEvent;
}

const place = (o: Record<string, unknown>, ts?: number) =>
  evt(BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE, { type: "jitsi", ...o }, ts);
const move = (o: Record<string, unknown>, ts?: number) =>
  evt(BOARD_ACTIONS.MOVE_TO, { type: "jitsi", ...o }, ts);
const destroy = (o: Record<string, unknown>, ts?: number) =>
  evt(BOARD_ACTIONS.DESTROY, { type: "jitsi", ...o }, ts);

const ids = (r: { tiles: { id: unknown }[] }) => r.tiles.map((t) => t.id).sort();

describe("computeFinalJitsiObjectsFromEvents", () => {
  it("keeps a single published stream tile", () => {
    const r = computeFinalJitsiObjectsFromEvents([
      place({ id: "A", hostId: "tab1", participantId: "P1" }),
    ]);
    expect(ids(r)).toEqual(["A"]);
  });

  it("keeps BOTH concurrent streams from one tab (same generation) — the bug fix", () => {
    // One tab (hostId tab1) on one join (participantId P1) publishes two tiles.
    const r = computeFinalJitsiObjectsFromEvents([
      place({ id: "A", hostId: "tab1", participantId: "P1" }),
      place({ id: "B", hostId: "tab1", participantId: "P1" }),
    ]);
    expect(ids(r)).toEqual(["A", "B"]);
  });

  it("drops a prior-generation ghost (older participantId) while keeping the new tile", () => {
    // tab1 published tile A under join P1, then rejoined as P2 and published B.
    // A's heal/DESTROY never reached the archive — A is a stale ghost.
    const r = computeFinalJitsiObjectsFromEvents([
      place({ id: "A", hostId: "tab1", participantId: "P1" }, 1),
      place({ id: "B", hostId: "tab1", participantId: "P2" }, 2),
    ]);
    expect(ids(r)).toEqual(["B"]);
  });

  it("re-adopts an old tile when the publisher heals it to the current generation", () => {
    // After rejoin (P2), the publisher re-stamps tile A to P2 via a MOVE_TO and
    // also publishes B under P2. Both are current-generation → both survive.
    const r = computeFinalJitsiObjectsFromEvents([
      place({ id: "A", hostId: "tab1", participantId: "P1" }, 1),
      move({ id: "A", hostId: "tab1", participantId: "P2" }, 2),
      place({ id: "B", hostId: "tab1", participantId: "P2" }, 3),
    ]);
    expect(ids(r)).toEqual(["A", "B"]);
  });

  it("removes a tile that received a DESTROY and reports its id", () => {
    const r = computeFinalJitsiObjectsFromEvents([
      place({ id: "A", hostId: "tab1", participantId: "P1" }, 1),
      place({ id: "B", hostId: "tab1", participantId: "P1" }, 2),
      destroy({ id: "A", hostId: "tab1", participantId: "P1" }, 3),
    ]);
    expect(ids(r)).toEqual(["B"]);
    expect(r.destroyedIds).toContain("A");
  });

  it("keeps independent tabs (different hostIds) separate", () => {
    const r = computeFinalJitsiObjectsFromEvents([
      place({ id: "A", hostId: "tab1", participantId: "P1" }),
      place({ id: "B", hostId: "tab2", participantId: "Q1" }),
    ]);
    expect(ids(r)).toEqual(["A", "B"]);
  });

  it("applies events in timestamp order regardless of array order", () => {
    // Newer generation (P2) arrives in the array BEFORE the older (P1) event.
    const r = computeFinalJitsiObjectsFromEvents([
      place({ id: "B", hostId: "tab1", participantId: "P2" }, 2),
      place({ id: "A", hostId: "tab1", participantId: "P1" }, 1),
    ]);
    expect(ids(r)).toEqual(["B"]);
  });

  it("keeps tiles with no host/participant binding (legacy data)", () => {
    const r = computeFinalJitsiObjectsFromEvents([place({ id: "A" })]);
    expect(ids(r)).toEqual(["A"]);
  });

  it("ignores non-jitsi objects and non-board topics", () => {
    const chat = {
      id: "c1",
      mqttTimestamp: ++seq,
      topic: "chat",
      payload: JSON.stringify({
        type: BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE,
        object: { id: "X", type: "jitsi" },
      }),
    } as ReplayEvent;
    const avatar = evt(BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE, { id: "Y", type: "avatar" });
    const r = computeFinalJitsiObjectsFromEvents([
      chat,
      avatar,
      place({ id: "A", hostId: "tab1", participantId: "P1" }),
    ]);
    expect(ids(r)).toEqual(["A"]);
  });
});
