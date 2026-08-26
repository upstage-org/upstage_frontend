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

const { shapeObject } = vi.hoisted(() => ({ shapeObject: vi.fn() }));

vi.mock("@stores/pinia/stage", () => ({
  useStageStore: () => ({
    activeMovable: null,
    shapeObject,
  }),
}));

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
