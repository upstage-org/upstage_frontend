// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

/**
 * The shared Shape row: live stream tiles (jitsi + RTMP) get the full
 * frame-shape swatch row; other object types don't. Picking a shape goes
 * through the generic shapeObject broadcast (like flip/opacity) and leaves
 * the menu open so shapes can be tried in place.
 */

const { shapeObject } = vi.hoisted(() => ({ shapeObject: vi.fn() }));

// Same reactive-stand-in pattern as LiveStreamPlayer.spec.ts: the menu only
// reads a handful of store fields lazily, so a plain object suffices.
vi.mock("@stores/pinia/stage", () => ({
  useStageStore: () => ({
    canPlay: false,
    session: null,
    currentAvatar: null,
    shapeObject,
  }),
}));
vi.mock("@stores/pinia/user", () => ({
  useUserStore: () => ({ avatarId: null, setAvatarId: vi.fn() }),
}));

import ContextMenuAvatar from "./ContextMenuAvatar.vue";
import { FRAME_SHAPES } from "../frameShapes";

const mountMenu = (object: Record<string, unknown>) =>
  mount(ContextMenuAvatar, {
    props: { object, closeMenu: vi.fn() },
    global: {
      mocks: { $t: (key: string) => key },
      stubs: {
        // ant-design-vue tooltip is registered app-wide in main.ts; render
        // its default slot so the buttons stay reachable.
        "a-tooltip": { template: "<span><slot /></span>" },
        Icon: true,
      },
      provide: { isWearing: ref(false), holdable: ref(false) },
    },
  });

beforeEach(() => {
  shapeObject.mockClear();
});

describe("ContextMenuAvatar shape row", () => {
  it("shows every preset swatch for an RTMP tile and broadcasts the pick", async () => {
    const object = { id: "o1", type: "video", isRTMP: true, name: "feed" };
    const wrapper = mountMenu(object);

    const swatches = wrapper.findAll("[data-testid^='shape-']");
    expect(swatches).toHaveLength(FRAME_SHAPES.length);

    await wrapper.find("[data-testid='shape-hexagon']").trigger("click");
    expect(shapeObject).toHaveBeenCalledWith({ ...object, shape: "hexagon" });
    // Menu stays open (same as the old jitsi square/circle buttons) so
    // several shapes can be tried without re-opening.
    expect(wrapper.props("closeMenu")).not.toHaveBeenCalled();
  });

  it("shows the row for a jitsi tile with the per-kind default highlighted", () => {
    const wrapper = mountMenu({ id: "o2", type: "jitsi", shape: null });
    expect(wrapper.findAll("[data-testid^='shape-']")).toHaveLength(FRAME_SHAPES.length);
    // null = legacy 12px look = "rounded" for jitsi.
    expect(wrapper.find("[data-testid='shape-rounded']").classes()).toContain(
      "has-background-primary-light",
    );
    expect(wrapper.find("[data-testid='shape-rect']").classes()).not.toContain(
      "has-background-primary-light",
    );
  });

  it("highlights legacy 'circle' broadcasts on the circle swatch", () => {
    const wrapper = mountMenu({ id: "o3", type: "jitsi", shape: "circle" });
    expect(wrapper.find("[data-testid='shape-circle']").classes()).toContain(
      "has-background-primary-light",
    );
  });

  it("offers no shape row on non-stream objects", () => {
    const wrapper = mountMenu({ id: "o4", type: "avatar" });
    expect(wrapper.findAll("[data-testid^='shape-']")).toHaveLength(0);
  });
});
