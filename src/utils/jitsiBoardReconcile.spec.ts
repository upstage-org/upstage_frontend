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

  it("reports every tile id the archive has heard of, including destroyed and ghost tiles", () => {
    const r = computeFinalJitsiObjectsFromEvents([
      place({ id: "live", hostId: "tab1", participantId: "p2" }),
      place({ id: "ghost", hostId: "tab1", participantId: "p1" }, 0),
      place({ id: "gone", hostId: "tab2", participantId: "q1" }),
      destroy({ id: "gone", hostId: "tab2", participantId: "q1" }),
    ]);
    expect([...r.seenIds].sort()).toEqual(["ghost", "gone", "live"]);
    expect(ids(r)).toEqual(["live"]);
  });
});

/**
 * Scene changes replace the whole board on every live client without any
 * DESTROY event. The reconcile used to ignore them, so a stream tile that a
 * scene switch had removed came back as a ghost on the next stage load or
 * MQTT reconnect (seen on prod 2026-11-23; matches the 2026-11-21 rehearsal
 * report of a stream that "appeared" for some players only).
 */
describe("computeFinalJitsiObjectsFromEvents — scene changes", () => {
  const background = (payload: Record<string, unknown>, ts = ++seq): ReplayEvent =>
    ({
      id: `b${seq}`,
      mqttTimestamp: ts,
      topic: "background",
      payload: JSON.stringify(payload),
    }) as ReplayEvent;
  const blankScene = (ts?: number) => background({ type: "blankScene" }, ts);
  const switchScene = (scene: unknown, ts?: number) =>
    background({ type: "switchScene", scene }, ts);
  const tile = (o: Record<string, unknown>) => ({ type: "jitsi", ...o });

  it("the blank scene removes the tiles that were on stage", () => {
    const r = computeFinalJitsiObjectsFromEvents([
      place({ id: "a", hostId: "tab1", participantId: "p1" }),
      blankScene(),
    ]);
    expect(ids(r)).toEqual([]);
    expect(r.destroyedIds).toEqual([]);
    expect(r.seenIds).toContain("a");
  });

  it("a tile placed after the scene change stays", () => {
    const r = computeFinalJitsiObjectsFromEvents([
      place({ id: "a", hostId: "tab1", participantId: "p1" }),
      blankScene(),
      place({ id: "b", hostId: "tab1", participantId: "p1" }),
    ]);
    expect(ids(r)).toEqual(["b"]);
  });

  it("switching to a saved scene leaves exactly the tiles that scene carries", () => {
    const scenes: Record<string, unknown[]> = {
      s1: [
        tile({ id: "inScene", hostId: "tab2", participantId: "q1" }),
        { id: "img", type: "avatar" },
      ],
    };
    const r = computeFinalJitsiObjectsFromEvents(
      [place({ id: "a", hostId: "tab1", participantId: "p1" }), switchScene("s1")],
      { sceneJitsiTiles: (id) => (scenes[String(id)] as never) ?? null },
    );
    expect(ids(r)).toEqual(["inScene"]);
    expect(r.seenIds).toEqual(expect.arrayContaining(["a", "inScene"]));
  });

  it("switching to a scene without stream tiles removes them all", () => {
    const r = computeFinalJitsiObjectsFromEvents(
      [place({ id: "a", hostId: "tab1", participantId: "p1" }), switchScene("empty")],
      { sceneJitsiTiles: () => [] },
    );
    expect(ids(r)).toEqual([]);
  });

  it("an unknown scene changes nothing (the live clients applied nothing either)", () => {
    const events = [place({ id: "a", hostId: "tab1", participantId: "p1" }), switchScene("gone")];
    expect(
      ids(computeFinalJitsiObjectsFromEvents(events, { sceneJitsiTiles: () => null })),
    ).toEqual(["a"]);
    expect(ids(computeFinalJitsiObjectsFromEvents(events))).toEqual(["a"]);
  });

  it("a scene tile healed afterwards to the performer's current id survives; a stale one does not shadow it", () => {
    const r = computeFinalJitsiObjectsFromEvents(
      [
        place({ id: "old", hostId: "tab1", participantId: "p1" }),
        switchScene("s1"),
        move({ id: "old", hostId: "tab1", participantId: "p2" }),
      ],
      {
        sceneJitsiTiles: () => [tile({ id: "old", hostId: "tab1", participantId: "p1" }) as never],
      },
    );
    expect(ids(r)).toEqual(["old"]);
    expect((r.tiles[0] as { participantId?: string }).participantId).toBe("p2");
  });

  it("applies scene changes in timestamp order with board events", () => {
    const r = computeFinalJitsiObjectsFromEvents([
      blankScene(20),
      place({ id: "before", hostId: "tab1", participantId: "p1" }, 10),
      place({ id: "after", hostId: "tab1", participantId: "p1" }, 30),
    ]);
    expect(ids(r)).toEqual(["after"]);
  });

  it("ignores other background messages", () => {
    const r = computeFinalJitsiObjectsFromEvents([
      place({ id: "a", hostId: "tab1", participantId: "p1" }),
      background({ type: "drawCurtain", curtain: null }),
      background({ type: "setBackdropColor", color: "#fff" }),
    ]);
    expect(ids(r)).toEqual(["a"]);
  });
});
