// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * Real-time movement, sender side.
 *
 * Dragging an object publishes its position while the pointer is down —
 * throttled to LIVE_MOVE_INTERVAL_MS and flagged `live` — so the audience
 * sees the object travel the same path at the same time. The release still
 * publishes the final position the old way (no `live` flag). While a
 * drag-move is in flight there is no ghost copy and no half-opacity
 * preview: the element under the pointer is the object everyone is
 * watching. Rotating with the tilt handle follows the same contract (the
 * angle is published live while the handle is held). Resize is unchanged:
 * publish on release, ghost shown.
 */

const { instances, storeState } = vi.hoisted(() => ({
  instances: [] as Array<{ handlers: Record<string, (e: unknown) => void> }>,
  storeState: { store: null as Record<string, unknown> | null },
}));

vi.mock("moveable", () => ({
  default: class MockMoveable {
    handlers: Record<string, (e: unknown) => void> = {};
    constructor() {
      instances.push(this);
    }
    on(event: string, handler: (e: unknown) => void) {
      this.handlers[event] = handler;
      return this;
    }
    setState(_state: unknown, cb?: () => void) {
      cb?.();
    }
    updateRect() {}
    dragStart() {}
    destroy() {}
  },
}));

vi.mock("animejs", () => ({
  animate: () => ({ pause: vi.fn() }),
}));

vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    activeMovable: null as string | null,
    canPlay: true,
    config: { animateDuration: 500 },
    board: { objects: [] as Array<{ id: string }> },
    shapeObject: vi.fn(),
    isLiveMoving: () => false,
    SET_ACTIVE_MOVABLE: (id: string | null) => {
      store.activeMovable = id;
    },
  });
  storeState.store = store as unknown as Record<string, unknown>;
  return { useStageStore: () => store };
});

import Moveable, { LIVE_MOVE_INTERVAL_MS } from "./Moveable.vue";

const OBJECT = {
  id: "avatar-1",
  type: "avatar",
  x: 100,
  y: 100,
  w: 150,
  h: 150,
  opacity: 1,
  rotate: 0,
};

const mountMoveable = () =>
  mount(Moveable, {
    props: { object: { ...OBJECT }, controlable: true, active: false },
    slots: { default: "<div class='object'>content</div>" },
    global: {
      directives: { "click-outside": {} },
    },
  });

const shapeObject = () => storeState.store!.shapeObject as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  instances.length = 0;
  shapeObject().mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("drag-move", () => {
  it("publishes throttled live positions during the drag and the final one on release", async () => {
    const wrapper = mountMoveable();
    const { handlers } = instances[0];
    const target = wrapper.find("div").element as HTMLElement;

    handlers.dragStart({});
    handlers.drag({ target, left: 110, top: 120 });
    handlers.drag({ target, left: 115, top: 125 }); // inside the throttle window
    expect(shapeObject()).toHaveBeenCalledTimes(1);
    expect(shapeObject()).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: OBJECT.id, x: 110, y: 120 }),
      { live: true },
    );

    vi.advanceTimersByTime(LIVE_MOVE_INTERVAL_MS);
    handlers.drag({ target, left: 130, top: 140 });
    expect(shapeObject()).toHaveBeenCalledTimes(2);
    expect(shapeObject()).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: OBJECT.id, x: 130, y: 140 }),
      { live: true },
    );

    handlers.dragEnd({ target, lastEvent: { left: 132, top: 142 } });
    expect(shapeObject()).toHaveBeenCalledTimes(3);
    const finalCall = shapeObject().mock.calls[2];
    expect(finalCall[0]).toEqual(expect.objectContaining({ id: OBJECT.id, x: 132, y: 142 }));
    expect(finalCall[1]).toBeUndefined();
  });

  it("shows no ghost and keeps full opacity while the drag is live", async () => {
    const wrapper = mountMoveable();
    const { handlers } = instances[0];
    const target = wrapper.find("div").element as HTMLElement;

    handlers.dragStart({});
    await nextTick();
    expect(wrapper.findAll(".object")).toHaveLength(1);
    expect(target.style.opacity).toBe("1");

    handlers.dragEnd({ target, lastEvent: { left: 10, top: 10 } });
    await nextTick();
    expect(wrapper.findAll(".object")).toHaveLength(1);
  });

  it("does not publish on a click that never moved", () => {
    const wrapper = mountMoveable();
    const { handlers } = instances[0];
    const target = wrapper.find("div").element as HTMLElement;
    handlers.dragStart({});
    handlers.dragEnd({ target, lastEvent: undefined });
    expect(shapeObject()).not.toHaveBeenCalled();
  });
});

describe("rotate", () => {
  it("publishes throttled live angles while the tilt handle is held and the final one on release", () => {
    const wrapper = mountMoveable();
    const { handlers } = instances[0];
    const target = wrapper.find("div").element as HTMLElement;

    handlers.rotateStart({ set: vi.fn() });
    handlers.rotate({ target, rotate: 10 });
    handlers.rotate({ target, rotate: 15 }); // inside the throttle window
    expect(shapeObject()).toHaveBeenCalledTimes(1);
    expect(shapeObject()).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: OBJECT.id, rotate: 10 }),
      { live: true },
    );
    // The element under the pointer already shows the live angle.
    expect(target.style.transform).toBe("rotate(15deg)");

    vi.advanceTimersByTime(LIVE_MOVE_INTERVAL_MS);
    handlers.rotate({ target, rotate: 30 });
    expect(shapeObject()).toHaveBeenCalledTimes(2);
    expect(shapeObject()).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: OBJECT.id, rotate: 30 }),
      { live: true },
    );

    handlers.rotateEnd({ target, lastEvent: { rotate: 32 } });
    expect(shapeObject()).toHaveBeenCalledTimes(3);
    const finalCall = shapeObject().mock.calls[2];
    expect(finalCall[0]).toEqual(expect.objectContaining({ id: OBJECT.id, rotate: 32 }));
    expect(finalCall[1]).toBeUndefined();
  });

  it("shows no ghost and keeps full opacity while the rotation is live", async () => {
    const wrapper = mountMoveable();
    const { handlers } = instances[0];
    const target = wrapper.find("div").element as HTMLElement;

    handlers.rotateStart({ set: vi.fn() });
    await nextTick();
    expect(wrapper.findAll(".object")).toHaveLength(1);
    expect(target.style.opacity).toBe("1");

    handlers.rotateEnd({ target, lastEvent: { rotate: 5 } });
    await nextTick();
    expect(wrapper.findAll(".object")).toHaveLength(1);
  });

  it("does not publish when the handle is grabbed and released without moving", () => {
    const wrapper = mountMoveable();
    const { handlers } = instances[0];
    const target = wrapper.find("div").element as HTMLElement;
    handlers.rotateStart({ set: vi.fn() });
    handlers.rotateEnd({ target, lastEvent: undefined });
    expect(shapeObject()).not.toHaveBeenCalled();
  });
});

describe("resize (unchanged contract)", () => {
  it("keeps the ghost + half-opacity preview and publishes only on release", async () => {
    const wrapper = mountMoveable();
    const { handlers } = instances[0];
    const target = wrapper.find("div").element as HTMLElement;

    handlers.resizeStart({});
    await nextTick();
    expect(wrapper.findAll(".object")).toHaveLength(2);
    expect(target.style.opacity).toBe("0.5");

    handlers.resize({ target, width: 200, height: 200, drag: { left: 90, top: 90 } });
    expect(shapeObject()).not.toHaveBeenCalled();

    handlers.resizeEnd({
      target,
      lastEvent: { width: 200, height: 200, drag: { left: 90, top: 90 } },
    });
    expect(shapeObject()).toHaveBeenCalledTimes(1);
    expect(shapeObject().mock.calls[0][1]).toBeUndefined();
    await nextTick();
    expect(wrapper.findAll(".object")).toHaveLength(1);
  });
});
