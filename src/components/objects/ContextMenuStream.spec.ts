// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * The standardised context menu shared by individual jitsi streams and RTMP
 * feeds: Shape · Mute locally · Volume setting · Bring forward / Send back ·
 * Slider (opacity + move speed) · Flip · Remove. Mute/volume are LOCAL
 * (stage store `_streamLocalAudio`, never a shapeObject broadcast) so
 * performers sharing a room don't echo each other; shape/flip/depth still
 * ride the broadcast.
 */

const { shapeObject, bringToFront, sendToBack, deleteObject, openSettingPopup, audioState } =
  vi.hoisted(() => {
    // Plain mutable stand-in for `_streamLocalAudio` (vi.hoisted runs before
    // imports, so no Vue ref here — tests remount to observe label changes).
    const audioState = { muted: false };
    return {
      shapeObject: vi.fn(),
      bringToFront: vi.fn(),
      sendToBack: vi.fn(),
      deleteObject: vi.fn(),
      openSettingPopup: vi.fn(),
      audioState,
    };
  });

vi.mock("@stores/pinia/stage", () => ({
  useStageStore: () => ({
    shapeObject,
    bringToFront,
    sendToBack,
    deleteObject,
    openSettingPopup,
    streamLocalMuted: () => audioState.muted,
    streamLocalVolume: () => 100,
    toggleStreamLocalMuted: vi.fn(() => {
      audioState.muted = !audioState.muted;
    }),
  }),
}));

import ContextMenuStream from "./ContextMenuStream.vue";
import { FRAME_SHAPES } from "./frameShapes";

const closeMenu = vi.fn();

const mountMenu = (object: Record<string, unknown>) =>
  mount(ContextMenuStream, {
    props: {
      object,
      closeMenu,
      sliderMode: "opacity",
      setSliderMode: vi.fn(),
      keepActive: vi.fn(),
    },
    global: {
      mocks: { $t: (key: string) => key },
      stubs: {
        // ant-design-vue tooltip is registered app-wide in main.ts; render
        // its default slot so the buttons stay reachable.
        "a-tooltip": { template: "<span><slot /></span>" },
        Icon: true,
      },
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  audioState.muted = false;
});

describe("ContextMenuStream — the one menu for jitsi and RTMP tiles", () => {
  it.each([
    ["jitsi", { id: "o1", type: "jitsi", name: "cam" }],
    ["RTMP", { id: "o2", type: "video", isRTMP: true, name: "feed" }],
  ])("offers the standardised item set for a %s tile", (_kind, object) => {
    const wrapper = mountMenu(object);
    const text = wrapper.text();

    expect(wrapper.findAll("[data-testid^='shape-']")).toHaveLength(FRAME_SHAPES.length);
    expect(text).toContain("mute_locally");
    expect(text).toContain("volumn_setting");
    expect(text).toContain("bring_forward");
    expect(text).toContain("send_back");
    expect(text).toContain("slider");
    expect(text).toContain("flip");
    expect(text).toContain("remove");

    // A live tile has no timeline and no per-tile exit/costume semantics.
    for (const absent of [
      "play",
      "pause",
      "restart",
      "loop.on",
      "loop.off",
      "exit_setting",
      "transparency_setting",
      "add_to_avatar",
    ]) {
      expect(text).not.toContain(absent);
    }
  });

  it.each([
    ["jitsi", { id: "o1", type: "jitsi", name: "cam" }],
    ["RTMP", { id: "o2", type: "video", isRTMP: true, name: "feed" }],
  ])("offers the stretch/crop resize choice on a %s tile", (_kind, object) => {
    const wrapper = mountMenu(object);
    // Historical default: stretch (fill) highlighted, crop not.
    expect(wrapper.find("[data-testid='fit-fill']").classes()).toContain(
      "has-background-primary-light",
    );
    expect(wrapper.find("[data-testid='fit-cover']").classes()).not.toContain(
      "has-background-primary-light",
    );
  });

  it("broadcasts a crop pick, leaves the menu open, and never touches audio", async () => {
    const object = { id: "o1", type: "jitsi", name: "cam" };
    const wrapper = mountMenu(object);

    await wrapper.find("[data-testid='fit-cover']").trigger("click");
    expect(shapeObject).toHaveBeenCalledWith({ ...object, fit: "cover" });
    expect(closeMenu).not.toHaveBeenCalled();
    // The toggle is pure frame styling — the local audio state (mute/volume)
    // must be completely unaffected.
    expect(audioState.muted).toBe(false);

    expect(
      mountMenu({ ...object, fit: "cover" })
        .find("[data-testid='fit-cover']")
        .classes(),
    ).toContain("has-background-primary-light");
  });

  it("offers an explicit close item that only closes the menu", async () => {
    const wrapper = mountMenu({ id: "o1", type: "jitsi" });
    await wrapper.find("[data-testid='close-context-menu']").trigger("click");
    expect(closeMenu).toHaveBeenCalled();
    expect(shapeObject).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("broadcasts a shape pick and leaves the menu open", async () => {
    const object = { id: "o1", type: "video", isRTMP: true, name: "feed" };
    const wrapper = mountMenu(object);

    await wrapper.find("[data-testid='shape-hexagon']").trigger("click");
    expect(shapeObject).toHaveBeenCalledWith({ ...object, shape: "hexagon" });
    expect(closeMenu).not.toHaveBeenCalled();
  });

  it("highlights the per-kind default swatch (jitsi legacy null = rounded)", () => {
    const wrapper = mountMenu({ id: "o2", type: "jitsi", shape: null });
    expect(wrapper.find("[data-testid='shape-rounded']").classes()).toContain(
      "has-background-primary-light",
    );
    expect(wrapper.find("[data-testid='shape-rect']").classes()).not.toContain(
      "has-background-primary-light",
    );
  });

  it("mutes locally via the store (no broadcast) and keeps the menu open", async () => {
    const wrapper = mountMenu({ id: "o1", type: "jitsi" });
    const item = wrapper.find("[data-testid='stream-mute-locally']");
    expect(item.text()).toContain("mute_locally");

    await item.trigger("click");
    expect(audioState.muted).toBe(true);
    expect(shapeObject).not.toHaveBeenCalled();
    expect(closeMenu).not.toHaveBeenCalled();

    // A muted tile offers the unmute wording (fresh mount: the mock store
    // isn't reactive, so the label is read at render time).
    expect(mountMenu({ id: "o1", type: "jitsi" }).text()).toContain("unmute_locally");
  });

  it("opens the (local) volume popup and closes the menu", async () => {
    const wrapper = mountMenu({ id: "o1", type: "jitsi" });
    const volumeItem = wrapper
      .findAll("a.panel-block")
      .find((a) => a.text().includes("volumn_setting"));
    await volumeItem!.trigger("click");
    expect(openSettingPopup).toHaveBeenCalledWith({ type: "VolumeParameters" });
    expect(closeMenu).toHaveBeenCalled();
  });

  it("offers only opacity and move-speed slider modes (volume is the popup's job)", () => {
    const wrapper = mountMenu({ id: "o1", type: "jitsi" });
    const setSliderMode = wrapper.props("setSliderMode");
    const sliderButtons = wrapper
      .findAll(".menu-group")
      .find((g) => g.text().includes("slider"))!
      .findAll("button");
    expect(sliderButtons).toHaveLength(2);
    sliderButtons.forEach((b) => b.trigger("click"));
    expect(setSliderMode).toHaveBeenCalledWith("opacity");
    expect(setSliderMode).toHaveBeenCalledWith("speed");
    expect(setSliderMode).not.toHaveBeenCalledWith("volume");
  });

  it("removes the tile through deleteObject", async () => {
    const object = { id: "o2", type: "video", isRTMP: true };
    const wrapper = mountMenu(object);
    await wrapper.find("a.has-text-danger").trigger("click");
    expect(deleteObject).toHaveBeenCalledWith(object);
    expect(closeMenu).toHaveBeenCalled();
  });
});
