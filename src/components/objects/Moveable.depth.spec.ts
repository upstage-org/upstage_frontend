// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * Depth-tool "buried object" raise contract.
 *
 * When an object is the active movable (green frame — e.g. selected via a
 * Depth-bar rollover), its positioned wrapper div must carry a local
 * z-index raise so the object can be clicked/dragged even when other
 * objects are stacked over it. The raise has to live on the WRAPPER:
 * the wrapper's always-set `filter` (and any `opacity` < 1) makes it a
 * stacking context, so a z-index on the inner `.object` div can never
 * escape it — clicks kept landing on the covering object, which stole
 * the selection and made the Depth tool useless for buried objects.
 *
 * The raise is pure local render state (nothing is published), and must
 * stay below the active object's own control overlay (z-index 100 in
 * Object.vue).
 */

const { storeState } = vi.hoisted(() => ({
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

const OBJECT = {
  id: "buried-prop",
  type: "prop",
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
      // Registered app-wide in main.ts; a no-op stands in here.
      directives: { "click-outside": {} },
    },
  });

const store = () => storeState.store as unknown as { activeMovable: string | null };

describe("Moveable wrapper z-index raise (Depth tool buried-object access)", () => {
  beforeEach(() => {
    store().activeMovable = null;
  });

  it("raises the wrapper while this object is the active movable", async () => {
    const w = mountMoveable();
    const wrapper = w.find("div").element as HTMLElement;
    expect(wrapper.style.zIndex).toBe("");

    store().activeMovable = OBJECT.id;
    await nextTick();
    expect(wrapper.style.zIndex).toBe("30");
    // Must stay under the object's own control overlay (100 in Object.vue).
    expect(Number(wrapper.style.zIndex)).toBeLessThan(100);
    w.unmount();
  });

  it("drops the raise when the selection moves to another object", async () => {
    const w = mountMoveable();
    const wrapper = w.find("div").element as HTMLElement;

    store().activeMovable = OBJECT.id;
    await nextTick();
    expect(wrapper.style.zIndex).toBe("30");

    store().activeMovable = "some-other-object";
    await nextTick();
    expect(wrapper.style.zIndex).toBe("");

    store().activeMovable = null;
    await nextTick();
    expect(wrapper.style.zIndex).toBe("");
    w.unmount();
  });
});
