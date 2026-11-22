// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * A performer who navigates away leaves the Jitsi conference; every other
 * client drops that performer's tiles locally (USER_LEFT →
 * removeJitsiParticipantLocally). When the performer comes back, their tab
 * heals the persisted tile and broadcasts it — as a MOVE_TO, because the
 * tile is already published. That MOVE_TO must bring the tile back on
 * clients that dropped it, but never resurrect a tile removed by DESTROY.
 */

vi.mock("@services/mqtt", () => ({
  default: () => ({
    connect: vi.fn(),
    whenConnected: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => Promise.resolve()),
    sendMessage: vi.fn(() => Promise.resolve()),
    sendMessageSync: vi.fn(),
    receiveMessage: vi.fn(),
  }),
}));
vi.mock("@services/speech", () => ({
  avatarSpeak: vi.fn(),
  stopSpeaking: vi.fn(),
}));

import { useStageStore } from "./stage";
import { BOARD_ACTIONS } from "@utils/constants";

type StageStore = ReturnType<typeof useStageStore>;
type BoardMessageArg = Parameters<StageStore["handleBoardMessage"]>[0]["message"];

const tile = (extra: Record<string, unknown> = {}) =>
  ({
    id: "tile-1",
    name: "performer cam",
    type: "jitsi",
    participantId: "p-old",
    hostId: "tab-P",
    x: 100,
    y: 100,
    w: 200,
    h: 150,
    opacity: 1,
    rotate: 0,
    ...extra,
  }) as unknown as NonNullable<BoardMessageArg["object"]>;

const receive = (store: StageStore, type: string, object: BoardMessageArg["object"]) =>
  store.handleBoardMessage({
    message: { type, object, sender: "tab-P", seq: 1 } as BoardMessageArg,
  });

const findTile = (store: StageStore, id = "tile-1") =>
  store.board.objects.filter((o) => String(o.id) === id);

let store: StageStore;
beforeEach(() => {
  setActivePinia(createPinia());
  store = useStageStore();
  store.UPDATE_VIEWPORT({ width: 1000, height: 600 });
  store.session = "tab-audience";
});

describe("MOVE_TO for a jitsi tile this client dropped", () => {
  it("re-creates the tile after the performer left and came back", () => {
    receive(store, BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE, tile());
    expect(findTile(store)).toHaveLength(1);

    store.removeJitsiParticipantLocally("p-old");
    expect(findTile(store)).toHaveLength(0);

    receive(store, BOARD_ACTIONS.MOVE_TO, tile({ participantId: "p-new" }));
    const [back] = findTile(store);
    expect(back).toBeDefined();
    expect(back.participantId).toBe("p-new");
    expect(back.published).toBe(true);
    expect(back.liveAction).toBe(true);
  });

  it("updates a tile that is still there instead of adding a second one", () => {
    receive(store, BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE, tile());
    receive(store, BOARD_ACTIONS.MOVE_TO, tile({ participantId: "p-new", x: 300 }));
    const tiles = findTile(store);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].participantId).toBe("p-new");
  });

  it("never resurrects a tile removed by DESTROY", () => {
    receive(store, BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE, tile());
    receive(store, BOARD_ACTIONS.DESTROY, tile());
    receive(store, BOARD_ACTIONS.MOVE_TO, tile({ participantId: "p-new" }));
    expect(findTile(store)).toHaveLength(0);
  });

  it("recovers again once the destroyed tile has been placed anew", () => {
    receive(store, BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE, tile());
    receive(store, BOARD_ACTIONS.DESTROY, tile());
    receive(store, BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE, tile());
    store.removeJitsiParticipantLocally("p-old");
    receive(store, BOARD_ACTIONS.MOVE_TO, tile({ participantId: "p-new" }));
    expect(findTile(store)).toHaveLength(1);
  });

  it("still ignores a MOVE_TO for an unknown object that is not a jitsi tile", () => {
    receive(store, BOARD_ACTIONS.MOVE_TO, tile({ id: "prop-1", type: "prop" }));
    expect(findTile(store, "prop-1")).toHaveLength(0);
  });
});

/**
 * reconcileJitsiBoardFromEvents runs whenever the event archive is reloaded
 * (stage load finishing, every MQTT reconnect). It used to delete EVERY
 * jitsi tile the archive did not list — including the tile this tab had
 * just dropped on the stage and not announced yet (bulb off, or waiting for
 * the conference to assign a participant id), which nobody else could
 * possibly have archived.
 */
describe("archive reconcile and this tab's own not-yet-announced tile", () => {
  const boardEvent = (type: string, object: Record<string, unknown>, ts: number) => ({
    id: `e${ts}`,
    mqttTimestamp: ts,
    topic: "board",
    payload: JSON.stringify({ type, object }),
  });
  const reconcile = (events: unknown[]) =>
    store.reconcileJitsiBoardFromEvents(
      events as Parameters<StageStore["reconcileJitsiBoardFromEvents"]>[0],
    );
  const pushLocal = (extra: Record<string, unknown>) =>
    store.board.objects.push({ ...tile(), ...extra } as never);

  beforeEach(() => {
    store.session = "tab-me";
  });

  it("keeps an own tile that was never announced (unlit / waiting for a participant id)", () => {
    pushLocal({ id: "mine", hostId: "tab-me", participantId: null, published: false });
    reconcile([]);
    expect(findTile(store, "mine")).toHaveLength(1);
  });

  it("still removes an own tile the archive says was destroyed", () => {
    pushLocal({ id: "mine", hostId: "tab-me", published: false });
    reconcile([
      boardEvent(BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE, tile({ id: "mine", hostId: "tab-me" }), 1),
      boardEvent(BOARD_ACTIONS.DESTROY, tile({ id: "mine", hostId: "tab-me" }), 2),
    ]);
    expect(findTile(store, "mine")).toHaveLength(0);
  });

  it("still removes an own PUBLISHED tile the archive has no record of (unchanged)", () => {
    pushLocal({ id: "mine", hostId: "tab-me", published: true });
    reconcile([]);
    expect(findTile(store, "mine")).toHaveLength(0);
  });

  it("still removes someone else's tile the archive does not list (unchanged)", () => {
    pushLocal({ id: "theirs", hostId: "tab-other", published: false });
    reconcile([]);
    expect(findTile(store, "theirs")).toHaveLength(0);
  });

  it("keeps archived tiles and the own unannounced tile side by side", () => {
    pushLocal({ id: "mine", hostId: "tab-me", participantId: null, published: false });
    reconcile([
      boardEvent(
        BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE,
        tile({ id: "theirs", hostId: "tab-other", participantId: "p9" }),
        1,
      ),
    ]);
    expect(findTile(store, "mine")).toHaveLength(1);
    expect(findTile(store, "theirs")).toHaveLength(1);
  });
});
