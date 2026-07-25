// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Depth-tool z-order regression tests (BRING_TO_FRONT_OF).
 *
 * Every performer is subscribed to the board topic with no `noLocal`, so a
 * client always receives the echo of its own publish. The legacy mutation
 * ("remove `front`, insert at `back`'s pre-removal index") was only correct
 * applied ONCE: re-applying it moved the already-moved object to the OTHER
 * side of `back`, so the sender's echo visually undid the Depth-tool drag
 * (with two stacked objects the net effect was exactly nothing). The wire
 * message now carries the resolved `side` so re-application converges.
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
// stage.ts transitively imports the meSpeak-backed speech service, which
// reads `window.meSpeak` at module scope (loaded from a <script> tag in the
// real app; absent under jsdom).
vi.mock("@services/speech", () => ({
  avatarSpeak: vi.fn(),
  stopSpeaking: vi.fn(),
}));

import { useStageStore } from "./stage";
import { BOARD_ACTIONS, TOPICS } from "@utils/constants";

type StageStore = ReturnType<typeof useStageStore>;
type BoardObjectArg = Parameters<StageStore["PUSH_OBJECT"]>[0];
type BoardMessageArg = Parameters<StageStore["handleBoardMessage"]>[0]["message"];

const seed = (store: StageStore, ids: string[], extra: Record<string, unknown> = {}) => {
  ids.forEach((id) =>
    store.PUSH_OBJECT({
      id,
      name: id,
      type: "prop",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      ...extra,
    } as unknown as BoardObjectArg),
  );
};
const order = (store: StageStore) => store.objects.map((o) => String(o.id));

let store: StageStore;
beforeEach(() => {
  setActivePinia(createPinia());
  store = useStageStore();
  sendMessage.mockClear();
});

describe("bringToFrontOf (Depth-tool drag)", () => {
  it("drag frontward lands the object just in front of the target", () => {
    seed(store, ["a", "b", "c"]);
    store.bringToFrontOf({ front: "a", back: "c" });
    expect(order(store)).toEqual(["b", "c", "a"]);
  });

  it("drag backward lands the object just behind the target", () => {
    seed(store, ["a", "b", "c"]);
    store.bringToFrontOf({ front: "c", back: "a" });
    expect(order(store)).toEqual(["c", "a", "b"]);
  });

  it("the sender's own MQTT echo does not undo the reorder", () => {
    seed(store, ["hidden", "cover"], { liveAction: true });
    store.bringToFrontOf({ front: "hidden", back: "cover" });
    expect(order(store)).toEqual(["cover", "hidden"]);

    // Replay the exact published payload back into the store, as the broker
    // echo does via handleBoardMessage.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [topic, payload] = sendMessage.mock.calls[0] as unknown as [string, BoardMessageArg];
    expect(topic).toBe(TOPICS.BOARD);
    expect(payload).toMatchObject({
      type: BOARD_ACTIONS.BRING_TO_FRONT_OF,
      front: "hidden",
      back: "cover",
      side: "front",
    });
    store.handleBoardMessage({ message: payload });
    expect(order(store)).toEqual(["cover", "hidden"]);
  });

  it("re-application converges in both directions (QoS-1 duplicate safety)", () => {
    seed(store, ["a", "b", "c"]);
    store.BRING_TO_FRONT_OF({ front: "c", back: "a", side: "behind" });
    expect(order(store)).toEqual(["c", "a", "b"]);
    store.BRING_TO_FRONT_OF({ front: "c", back: "a", side: "behind" });
    expect(order(store)).toEqual(["c", "a", "b"]);
  });

  it("a legacy message without `side` keeps the old single-application result", () => {
    // Observer that never applied locally (old build / recorded archive).
    seed(store, ["a", "b", "c"]);
    store.handleBoardMessage({
      message: { type: BOARD_ACTIONS.BRING_TO_FRONT_OF, front: "a", back: "c" },
    });
    expect(order(store)).toEqual(["b", "c", "a"]);

    setActivePinia(createPinia());
    const replica = useStageStore();
    seed(replica, ["a", "b", "c"]);
    replica.handleBoardMessage({
      message: { type: BOARD_ACTIONS.BRING_TO_FRONT_OF, front: "c", back: "a" },
    });
    expect(order(replica)).toEqual(["c", "a", "b"]);
  });

  it("publishes for published objects even while the bulb is off", () => {
    seed(store, ["a", "b"], { liveAction: false, published: true });
    store.bringToFrontOf({ front: "a", back: "b" });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("stays local for never-published bulb-off objects", () => {
    seed(store, ["a", "b"]);
    store.bringToFrontOf({ front: "a", back: "b" });
    expect(order(store)).toEqual(["b", "a"]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("ignores drops onto the object itself and unknown ids", () => {
    seed(store, ["a", "b"]);
    store.bringToFrontOf({ front: "a", back: "a" });
    store.bringToFrontOf({ front: "ghost", back: "b" });
    expect(order(store)).toEqual(["a", "b"]);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
