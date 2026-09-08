// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * Glide easing contract — what Moveable.vue hands to animejs when an
 * object's stored position changes (remote move, release after a drag,
 * scene switch).
 *
 *  - moveSpeed > 1000 ms: constant speed (`ease: "linear"`). This was the
 *    original intent, but the v3-era `easing` key was ignored by animejs
 *    v4 (which only reads `ease`) so slow moves coasted in on the default
 *    decelerating curve.
 *  - moveSpeed <= 1000 ms: animejs default (no `ease` passed).
 *  - live drag from another performer: LIVE_MOVE_TWEEN_MS, linear.
 */

const { animate, storeState } = vi.hoisted(() => ({
  animate: vi.fn(() => ({ pause: vi.fn() })),
  storeState: { store: null as Record<string, unknown> | null },
}));

vi.mock("moveable", () => ({
  default: class MockMoveable {
    on() {
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

vi.mock("animejs", () => ({ animate }));

vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    activeMovable: null as string | null,
    canPlay: true,
    config: { animateDuration: 500 },
    board: { objects: [] as Array<{ id: string }> },
    shapeObject: vi.fn(),
    liveMoving: false,
    isLiveMoving: () => store.liveMoving,
    SET_ACTIVE_MOVABLE: (id: string | null) => {
      store.activeMovable = id;
    },
  });
  storeState.store = store as unknown as Record<string, unknown>;
  return { useStageStore: () => store };
});

import Moveable, { LIVE_MOVE_TWEEN_MS } from "./Moveable.vue";

const OBJECT = {
  id: "prop-1",
  type: "prop",
  x: 100,
  y: 100,
  w: 150,
  h: 150,
  opacity: 1,
  rotate: 0,
};

const mountWith = (extra: Record<string, unknown>) =>
  mount(Moveable, {
    props: { object: { ...OBJECT, ...extra }, controlable: false, active: false },
    slots: { default: "<div class='object'>content</div>" },
    global: { directives: { "click-outside": {} } },
  });

type AnimateOptions = Record<string, unknown>;
const lastAnimateOptions = (): AnimateOptions => {
  const calls = animate.mock.calls as unknown as [unknown, AnimateOptions][];
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1];
};

/** Move the object in the store the way UPDATE_OBJECT does, then flush. */
const moveTo = async (wrapper: ReturnType<typeof mountWith>, x: number) => {
  const current = wrapper.props("object") as Record<string, unknown>;
  await wrapper.setProps({ object: { ...current, x } });
  await nextTick();
};

beforeEach(() => {
  animate.mockClear();
  (storeState.store as { liveMoving: boolean }).liveMoving = false;
});

describe("glide easing", () => {
  it("slow moves (moveSpeed > 1000) travel linearly over moveSpeed", async () => {
    const wrapper = mountWith({ moveSpeed: 2000 });
    await moveTo(wrapper, 400);
    const opts = lastAnimateOptions();
    expect(opts.ease).toBe("linear");
    expect(opts.duration).toBe(2000);
    expect(opts).not.toHaveProperty("easing");
  });

  it("quick moves (moveSpeed <= 1000) keep animejs's default ease", async () => {
    const wrapper = mountWith({ moveSpeed: 1000 });
    await moveTo(wrapper, 400);
    const opts = lastAnimateOptions();
    expect(opts).not.toHaveProperty("ease");
    expect(opts).not.toHaveProperty("easing");
    expect(opts.duration).toBe(1000);
  });

  it("falls back to config.animateDuration when the object has no moveSpeed", async () => {
    const wrapper = mountWith({});
    await moveTo(wrapper, 400);
    const opts = lastAnimateOptions();
    expect(opts.duration).toBe(500);
    expect(opts).not.toHaveProperty("ease");
  });

  it("a live drag from another performer tweens linearly at the publish cadence", async () => {
    (storeState.store as { liveMoving: boolean }).liveMoving = true;
    const wrapper = mountWith({ moveSpeed: 5000 });
    await moveTo(wrapper, 400);
    const opts = lastAnimateOptions();
    expect(opts.ease).toBe("linear");
    expect(opts.duration).toBe(LIVE_MOVE_TWEEN_MS);
  });
});
