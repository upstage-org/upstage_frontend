// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Real-time movement contract (see the "Real-time movement" block above
 * `shapeObject` in stage.ts).
 *
 * A drag publishes many MOVE_TOs per second. Every performer receives the
 * echo of its own publishes (no noLocal), so an echo of an OLDER position
 * can land after a newer one was already applied locally and jerk the
 * object back. Own echoes older than the latest local publish for that
 * object are dropped; everything else (other senders, our newest, replays)
 * is applied as before. `live` MOVE_TOs mark the object (and its costumes)
 * as live-moving so Moveable.vue tweens them at the publish cadence.
 */

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn(() => Promise.resolve()),
}));
vi.mock("@services/mqtt", () => ({
  default: () => ({
    connect: vi.fn(),
    whenConnected: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => Promise.resolve()),
    sendMessage,
    sendMessageSync: vi.fn(),
    receiveMessage: vi.fn(),
  }),
}));
vi.mock("@services/speech", () => ({
  avatarSpeak: vi.fn(),
  stopSpeaking: vi.fn(),
}));

import { useStageStore } from "./stage";
import { BOARD_ACTIONS, TOPICS } from "@utils/constants";

type StageStore = ReturnType<typeof useStageStore>;
type BoardObjectArg = Parameters<StageStore["PUSH_OBJECT"]>[0];
type BoardMessageArg = Parameters<StageStore["handleBoardMessage"]>[0]["message"];

const seed = (store: StageStore, id: string, extra: Record<string, unknown> = {}) =>
  store.PUSH_OBJECT({
    id,
    name: id,
    type: "prop",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    opacity: 1,
    rotate: 0,
    liveAction: true,
    published: true,
    ...extra,
  } as unknown as BoardObjectArg);

const objectX = (store: StageStore, id: string) =>
  store.board.objects.find((o) => String(o.id) === id)?.x;

const publishedMoveTos = () =>
  (sendMessage.mock.calls as unknown as [string, BoardMessageArg][])
    .filter(([topic, msg]) => topic === TOPICS.BOARD && msg.type === BOARD_ACTIONS.MOVE_TO)
    .map(([, msg]) => msg);

let store: StageStore;
beforeEach(() => {
  setActivePinia(createPinia());
  store = useStageStore();
  // Coordinates travel as fractions of the stage width; a zero viewport
  // (jsdom default) would turn every x into NaN.
  store.UPDATE_VIEWPORT({ width: 1000, height: 600 });
  store.session = "tab-A";
  sendMessage.mockClear();
});

describe("live drag publishes", () => {
  it("carry the live flag, the sender's session and a growing sequence", () => {
    seed(store, "a");
    const a = store.board.objects[0];
    store.shapeObject({ ...a, x: 10 }, { live: true });
    store.shapeObject({ ...a, x: 20 }, { live: true });
    store.shapeObject({ ...a, x: 30 });
    const msgs = publishedMoveTos();
    expect(msgs).toHaveLength(3);
    expect(msgs.map((m) => m.live)).toEqual([true, true, false]);
    expect(msgs.every((m) => m.sender === "tab-A")).toBe(true);
    const seqs = msgs.map((m) => m.seq as number);
    expect(seqs[0] < seqs[1] && seqs[1] < seqs[2]).toBe(true);
  });
});

describe("stale own echo guard", () => {
  it("drops an own echo older than the latest local publish", () => {
    seed(store, "a");
    const a = store.board.objects[0];
    store.shapeObject({ ...a, x: 10 }, { live: true });
    store.shapeObject({ ...a, x: 20 }, { live: true });
    const settled = objectX(store, "a");
    expect(settled).toBeCloseTo(20);

    const [first] = publishedMoveTos();
    store.handleBoardMessage({ message: first });
    expect(objectX(store, "a")).toBe(settled);
  });

  it("still applies the newest own echo", () => {
    seed(store, "a");
    const a = store.board.objects[0];
    store.shapeObject({ ...a, x: 10 }, { live: true });
    store.shapeObject({ ...a, x: 20 }, { live: true });
    const [, second] = publishedMoveTos();
    // Something local (not published) nudged the object in between; the
    // broker-ordered newest publish wins, as it does for everyone else.
    store.UPDATE_OBJECT({ ...store.board.objects[0], x: 999 });
    store.handleBoardMessage({ message: second });
    expect(objectX(store, "a")).toBeCloseTo(20);
  });

  it("never drops another sender's message, whatever its sequence", () => {
    seed(store, "a");
    const a = store.board.objects[0];
    store.shapeObject({ ...a, x: 10 }, { live: true });
    store.shapeObject({ ...a, x: 20 }, { live: true });
    const [first] = publishedMoveTos();
    store.handleBoardMessage({ message: { ...first, sender: "tab-B" } });
    expect(objectX(store, "a")).toBeCloseTo(10);
  });

  it("applies legacy MOVE_TOs without sender/seq (older clients, recordings)", () => {
    seed(store, "a");
    const a = store.board.objects[0];
    store.shapeObject({ ...a, x: 10 }, { live: true });
    store.shapeObject({ ...a, x: 20 }, { live: true });
    const [first] = publishedMoveTos();
    const { sender: _s, seq: _q, live: _l, ...legacy } = first;
    store.handleBoardMessage({ message: legacy });
    expect(objectX(store, "a")).toBeCloseTo(10);
  });

  it("is inactive during replay (a tab replaying its own recording)", () => {
    seed(store, "a");
    const a = store.board.objects[0];
    store.shapeObject({ ...a, x: 10 }, { live: true });
    store.shapeObject({ ...a, x: 20 }, { live: true });
    const [first] = publishedMoveTos();
    store.replay.isReplaying = true;
    store.handleBoardMessage({ message: first });
    expect(objectX(store, "a")).toBeCloseTo(10);
  });
});

describe("live-moving marker", () => {
  it("is set by a live MOVE_TO and cleared by the final one", () => {
    seed(store, "a");
    const a = store.board.objects[0];
    const live: BoardMessageArg = {
      type: BOARD_ACTIONS.MOVE_TO,
      object: { ...a, x: 10 },
      live: true,
      sender: "tab-B",
      seq: 1,
    };
    store.handleBoardMessage({ message: live });
    expect(store.isLiveMoving("a")).toBe(true);
    store.handleBoardMessage({
      message: { ...live, object: { ...a, x: 12 }, live: false, seq: 2 },
    });
    expect(store.isLiveMoving("a")).toBe(false);
  });

  it("covers costumes worn by the moving object", () => {
    seed(store, "a");
    seed(store, "hat", { wornBy: "a" });
    const a = store.board.objects.find((o) => o.id === "a")!;
    store.handleBoardMessage({
      message: {
        type: BOARD_ACTIONS.MOVE_TO,
        object: { ...a, x: 10 },
        live: true,
        sender: "tab-B",
        seq: 1,
      },
    });
    expect(store.isLiveMoving("hat")).toBe(true);
  });

  it("expires on its own if the final MOVE_TO never arrives", () => {
    vi.useFakeTimers();
    try {
      seed(store, "a");
      const a = store.board.objects[0];
      store.handleBoardMessage({
        message: {
          type: BOARD_ACTIONS.MOVE_TO,
          object: { ...a, x: 10 },
          live: true,
          sender: "tab-B",
          seq: 1,
        },
      });
      expect(store.isLiveMoving("a")).toBe(true);
      vi.advanceTimersByTime(2000);
      expect(store.isLiveMoving("a")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is untouched by a message that is not a MOVE_TO", () => {
    seed(store, "a");
    expect(store.isLiveMoving("a")).toBe(false);
  });
});
