// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * A hand resize of a TEXT publishes `wrap: true` with the new size: from then
 * on Text.vue's fitFrameToText keeps that width as the wrap width instead of
 * shrink-wrapping the widest line on every keystroke (2026-09-11). Other
 * object types resize exactly as before.
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

import Moveable from "./Moveable.vue";

const mountMoveable = (object: Record<string, unknown>) =>
  mount(Moveable, {
    props: {
      object: { x: 100, y: 100, w: 150, h: 150, opacity: 1, rotate: 0, ...object },
      controlable: true,
      active: false,
    },
    slots: { default: "<div class='object'>content</div>" },
    global: { directives: { "click-outside": {} } },
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

describe("resizeEnd on a text object", () => {
  it("publishes the new size flagged as the wrap width", () => {
    const wrapper = mountMoveable({ id: "t1", type: "text", content: "hello" });
    const target = wrapper.find("div").element as HTMLElement;
    instances[0].handlers.resizeEnd({
      target,
      lastEvent: { width: 120, height: 90, drag: { left: 100, top: 100 } },
    });
    expect(shapeObject()).toHaveBeenCalledTimes(1);
    expect(shapeObject().mock.calls[0][0]).toMatchObject({
      id: "t1",
      w: 120,
      h: 90,
      wrap: true,
    });
  });

  it("does not flag other object types", () => {
    const wrapper = mountMoveable({ id: "a1", type: "avatar" });
    const target = wrapper.find("div").element as HTMLElement;
    instances[0].handlers.resizeEnd({
      target,
      lastEvent: { width: 120, height: 90, drag: { left: 100, top: 100 } },
    });
    expect(shapeObject().mock.calls[0][0]).toMatchObject({ id: "a1", w: 120, h: 90 });
    expect(shapeObject().mock.calls[0][0]).not.toHaveProperty("wrap");
  });
});
