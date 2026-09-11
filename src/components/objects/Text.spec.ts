// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * fitFrameToText: the text object's frame follows the typed text BOTH ways
 * (2026-08-27). It grew but never shrank before, so deleting lines left a
 * huge invisible frame covering the stage and blocking the objects behind
 * it. Exact fit is safe for texts: the font doesn't scale with the frame,
 * so a hand-stretched frame buys nothing.
 */

const { shapeObject, storeState } = vi.hoisted(() => ({
  shapeObject: vi.fn(),
  storeState: { store: null as { activeMovable: string | null } | null },
}));

vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({ activeMovable: null as string | null, shapeObject });
  storeState.store = store;
  return { useStageStore: () => store };
});

import Text from "./Text.vue";

// jsdom computes no layout — offsetWidth/Height are always 0. Stub the
// INTRINSIC text size fitFrameToText measures (it sets width: max-content
// and reads offsetWidth/Height on the <p>).
const mountText = (object: Record<string, unknown>, intrinsic: { w: number; h: number }) => {
  const wrapper = mount(Text, {
    props: { object: { id: "t1", type: "text", content: "hello", editing: true, ...object } },
    global: {
      stubs: {
        // The real AppObject drags in Moveable/streams/etc.; the fit logic
        // only needs the #render slot mounted inside a plain parent box.
        AppObject: { template: "<div><slot name='render' /></div>" },
        MenuContent: true,
      },
    },
  });
  const p = wrapper.find("p").element as HTMLElement;
  Object.defineProperty(p, "offsetWidth", { get: () => intrinsic.w, configurable: true });
  Object.defineProperty(p, "offsetHeight", { get: () => intrinsic.h, configurable: true });
  return wrapper;
};

beforeEach(() => {
  shapeObject.mockClear();
  storeState.store!.activeMovable = null;
});

describe("Text fitFrameToText (two-way fit on keyup)", () => {
  it("shrinks the frame back when the text gets smaller", async () => {
    // Regression: grow-only fit returned {} here and the 400×200 frame
    // stayed forever after lines were deleted.
    const wrapper = mountText({ w: 400, h: 200 }, { w: 100, h: 30 });
    await wrapper.find("p").trigger("keyup");
    expect(shapeObject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "t1", w: 110, h: 40 }), // intrinsic + 10, matches saveText
    );
  });

  it("still grows the frame for new text", async () => {
    const wrapper = mountText({ w: 50, h: 20 }, { w: 100, h: 30 });
    await wrapper.find("p").trigger("keyup");
    expect(shapeObject).toHaveBeenCalledWith(expect.objectContaining({ w: 110, h: 40 }));
  });

  it("keeps a 40px width floor so an emptied text stays grabbable", async () => {
    const wrapper = mountText({ w: 200, h: 60 }, { w: 0, h: 20 });
    await wrapper.find("p").trigger("keyup");
    expect(shapeObject).toHaveBeenCalledWith(expect.objectContaining({ w: 40, h: 30 }));
  });

  it("leaves an already-exact frame untouched", async () => {
    const wrapper = mountText({ w: 110, h: 40 }, { w: 100, h: 30 });
    await wrapper.find("p").trigger("keyup");
    expect(shapeObject).toHaveBeenCalledTimes(1);
    // fitFrameToText returned {} — the payload carries the object's own
    // (unchanged) size, nothing overridden.
    expect(shapeObject.mock.calls[0][0]).toMatchObject({ w: 110, h: 40 });
  });
});

/**
 * Wrap mode (2026-09-11): once a performer has dragged a text's frame to a
 * width by hand (Moveable's resizeEnd sets `wrap: true`), that width is the
 * wrap width. Edit mode used to pin `white-space: nowrap`, so narrowing the
 * frame cut the line off instead of folding it, and the next keystroke's
 * max-content fit snapped the frame back to the full line width.
 */
describe("Text wrap mode (hand-sized width)", () => {
  it("keeps the hand-set width on keyup and only fits the height", async () => {
    // Intrinsic (unwrapped) width 300 would have snapped w back to 310.
    const wrapper = mountText({ w: 120, h: 40, wrap: true }, { w: 300, h: 60 });
    await wrapper.find("p").trigger("keyup");
    expect(shapeObject).toHaveBeenCalledTimes(1);
    expect(shapeObject.mock.calls[0][0]).toMatchObject({ w: 120, h: 70 });
  });

  it("measures the wrapped height at the frame width, not the DOM box", async () => {
    const wrapper = mountText({ w: 120, h: 40, wrap: true }, { w: 300, h: 60 });
    const p = wrapper.find("p").element as HTMLElement;
    const widths: string[] = [];
    Object.defineProperty(p, "offsetHeight", {
      get: () => {
        widths.push(p.style.width);
        return 60;
      },
      configurable: true,
    });
    await wrapper.find("p").trigger("keyup");
    expect(widths).toEqual(["120px"]);
    expect(p.style.width).toBe(""); // restored
  });

  it("lets edit-mode text fold: no nowrap once the frame was hand-sized", () => {
    const auto = mountText({ w: 120, h: 40, editing: true }, { w: 300, h: 60 });
    expect(auto.find("p").classes()).toContain("is-nowrap");
    const wrapped = mountText({ w: 120, h: 40, editing: true, wrap: true }, { w: 300, h: 60 });
    expect(wrapped.find("p").classes()).not.toContain("is-nowrap");
  });

  it("re-fits the height after a hand resize on the client holding the handles", async () => {
    const wrapper = mountText({ w: 300, h: 40, wrap: true }, { w: 300, h: 60 });
    storeState.store!.activeMovable = "t1";
    // Moveable's resizeEnd published a narrower frame with the height the
    // handle was dragged to; the wrapped text needs 60 + 10.
    await wrapper.setProps({
      object: {
        id: "t1",
        type: "text",
        content: "hello",
        editing: true,
        w: 120,
        h: 40,
        wrap: true,
      },
    });
    expect(shapeObject).toHaveBeenCalledTimes(1);
    expect(shapeObject.mock.calls[0][0]).toMatchObject({ id: "t1", w: 120, h: 70 });
  });

  it("does not echo a resize back from clients that are only watching", async () => {
    const wrapper = mountText({ w: 300, h: 40, wrap: true }, { w: 300, h: 60 });
    await wrapper.setProps({
      object: {
        id: "t1",
        type: "text",
        content: "hello",
        editing: true,
        w: 120,
        h: 40,
        wrap: true,
      },
    });
    expect(shapeObject).not.toHaveBeenCalled();
  });

  it("leaves auto-width texts alone when their width changes", async () => {
    const wrapper = mountText({ w: 300, h: 40 }, { w: 300, h: 60 });
    storeState.store!.activeMovable = "t1";
    await wrapper.setProps({
      object: { id: "t1", type: "text", content: "hello", editing: true, w: 120, h: 40 },
    });
    expect(shapeObject).not.toHaveBeenCalled();
  });
});
