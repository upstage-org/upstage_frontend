// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { ref } from "vue";

// The menu registers a document-level Enter listener on mount; auto-unmount
// keeps one test's menu from swallowing another test's keystrokes.
enableAutoUnmount(afterEach);

/**
 * Live stream tiles (jitsi + RTMP) no longer pass through this menu — they
 * use the standardised ContextMenuStream (see Avatar/index.vue and
 * Jitsi.vue). This menu keeps serving avatars, props and stream-playback
 * VIDEO FILES, whose transport controls (play/pause/restart/loop) must
 * survive the split.
 */

const { shapeObject, switchFrame, toggleAutoplayFrames } = vi.hoisted(() => ({
  shapeObject: vi.fn(),
  switchFrame: vi.fn(),
  toggleAutoplayFrames: vi.fn(),
}));

// Same reactive-stand-in pattern as LiveStreamPlayer.spec.ts: the menu only
// reads a handful of store fields lazily, so a plain object suffices.
vi.mock("@stores/pinia/stage", () => ({
  useStageStore: () => ({
    canPlay: false,
    session: null,
    currentAvatar: null,
    shapeObject,
    switchFrame,
    toggleAutoplayFrames,
  }),
}));
vi.mock("@stores/pinia/user", () => ({
  useUserStore: () => ({ avatarId: null, setAvatarId: vi.fn() }),
}));

import ContextMenuAvatar from "./ContextMenuAvatar.vue";

const mountMenu = (object: Record<string, unknown>) =>
  mount(ContextMenuAvatar, {
    props: { object, closeMenu: vi.fn() },
    // Attached: the Enter-to-close listener lives on `document` (Safari
    // doesn't focus buttons on click, so a root @keydown would miss it),
    // and capture only sees events from elements in the real DOM.
    attachTo: document.body,
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

const pressEnterOn = (el: Element) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

beforeEach(() => {
  shapeObject.mockClear();
  switchFrame.mockClear();
  toggleAutoplayFrames.mockClear();
});

describe("ContextMenuAvatar after the stream-menu split", () => {
  it("keeps the video-file transport controls (play/restart/volume/loop)", () => {
    const wrapper = mountMenu({ id: "v1", type: "video", name: "clip", isPlaying: false });
    const text = wrapper.text();
    expect(text).toContain("play");
    expect(text).toContain("restart");
    expect(text).toContain("volumn_setting");
    expect(text).toContain("loop.off");
  });

  it("shows the frame-shape row for videos only (avatars/props keep none)", () => {
    expect(mountMenu({ id: "o4", type: "avatar" }).findAll("[data-testid^='shape-']")).toHaveLength(
      0,
    );
    const video = mountMenu({ id: "v1", type: "video", name: "clip" });
    const swatches = video.findAll("[data-testid^='shape-']");
    expect(swatches.length).toBeGreaterThan(0);
    // Untouched videos have always been sharp-cornered rectangles.
    expect(video.find("[data-testid='shape-rect']").classes()).toContain(
      "has-background-primary-light",
    );
  });

  it("broadcasts the chosen shape via shapeObject and closes the menu", async () => {
    const closeMenu = vi.fn();
    const wrapper = mount(ContextMenuAvatar, {
      props: { object: { id: "v1", type: "video", name: "clip" }, closeMenu },
      global: {
        mocks: { $t: (key: string) => key },
        stubs: { "a-tooltip": { template: "<span><slot /></span>" }, Icon: true },
        provide: { isWearing: ref(false), holdable: ref(false) },
      },
    });
    await wrapper.find("[data-testid='shape-star']").trigger("click");
    expect(shapeObject).toHaveBeenCalledWith(expect.objectContaining({ id: "v1", shape: "star" }));
    // Every selection closes the menu (user request 2026-08-14).
    expect(closeMenu).toHaveBeenCalled();
  });

  it("keeps the exit-animation override for props/avatars", () => {
    expect(mountMenu({ id: "o4", type: "avatar" }).text()).toContain("exit_setting");
  });

  it("shows the stretch/crop row for videos only, defaulting to stretch", () => {
    expect(mountMenu({ id: "o4", type: "avatar" }).findAll("[data-testid^='fit-']")).toHaveLength(
      0,
    );
    const video = mountMenu({ id: "v1", type: "video", name: "clip" });
    expect(video.findAll("[data-testid^='fit-']")).toHaveLength(3);
    // <video> has always rendered object-fit: fill by default.
    expect(video.find("[data-testid='fit-fill']").classes()).toContain(
      "has-background-primary-light",
    );
  });

  /**
   * Animation-speed contract (user request 2026-08-27, "wait for a cue"):
   * typing or spinner clicks only ARM the number locally — nothing starts,
   * nothing may wipe the field — and Enter commits it (starting the
   * animation) and closes the menu. Enter also dismisses the menu after
   * frame-thumbnail picks, which themselves keep it open.
   */
  it("typing a speed only arms it: nothing starts, the menu stays open", async () => {
    const wrapper = mountMenu({ id: "m1", type: "avatar", multi: true, frames: ["a", "b"] });
    const input = wrapper.find("input.anmation-input");
    (input.element as HTMLInputElement).value = "2";
    await input.trigger("input");
    // Live preview used to shapeObject per keystroke — that started the
    // animation before the cue and (with Loop off) let the finished run
    // clear the field a few seconds later.
    expect(shapeObject).not.toHaveBeenCalled();
    expect(wrapper.props("closeMenu")).not.toHaveBeenCalled();
    // A change event alone (spinner / blur) must not commit either: a blur
    // commit would start the animation off-cue.
    await input.trigger("change");
    expect(shapeObject).not.toHaveBeenCalled();
    expect((input.element as HTMLInputElement).value).toBe("2");
  });

  it("keeps the armed number when the store clears autoplayFrames (run finished / pause)", async () => {
    const wrapper = mountMenu({
      id: "m1",
      type: "avatar",
      multi: true,
      frames: ["a", "b"],
      autoplayFrames: 2,
    });
    const input = wrapper.find("input.anmation-input");
    expect((input.element as HTMLInputElement).value).toBe("2");
    (input.element as HTMLInputElement).value = "3";
    await input.trigger("input");
    // A play-once run finishing writes autoplayFrames: null into the store
    // — the number the player is holding for their cue must survive it.
    await wrapper.setProps({
      object: { id: "m1", type: "avatar", multi: true, frames: ["a", "b"], autoplayFrames: null },
    });
    expect((input.element as HTMLInputElement).value).toBe("3");
    // A REAL external speed change (another player, the ▶ button) does
    // reflect into the field.
    await wrapper.setProps({
      object: { id: "m1", type: "avatar", multi: true, frames: ["a", "b"], autoplayFrames: 5 },
    });
    expect((input.element as HTMLInputElement).value).toBe("5");
  });

  it("Enter in the speed field commits the armed value and closes the menu", async () => {
    const wrapper = mountMenu({ id: "m1", type: "avatar", multi: true, frames: ["a", "b"] });
    const input = wrapper.find("input.anmation-input");
    (input.element as HTMLInputElement).value = "3.5";
    await input.trigger("input");
    pressEnterOn(input.element);
    expect(shapeObject).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1", autoplayFrames: 3.5 }),
    );
    expect(wrapper.props("closeMenu")).toHaveBeenCalled();
  });

  it("frame thumbnails keep the menu open; Enter then dismisses it", async () => {
    const wrapper = mountMenu({ id: "m1", type: "avatar", multi: true, frames: ["a", "b"] });
    const thumb = wrapper.find('img[src="a"]');
    expect(thumb.exists()).toBe(true);
    await thumb.trigger("click");
    expect(switchFrame).toHaveBeenCalledWith(expect.objectContaining({ id: "m1", src: "a" }));
    expect(wrapper.props("closeMenu")).not.toHaveBeenCalled();
    // The cue flow: pick a frame (or several), then Enter to dismiss.
    pressEnterOn(thumb.element);
    expect(wrapper.props("closeMenu")).toHaveBeenCalled();
    expect(shapeObject).not.toHaveBeenCalled();
  });

  it("Enter outside the menu closes it too — but never from a text-entry field", async () => {
    const wrapper = mountMenu({ id: "m1", type: "avatar", multi: true, frames: ["a", "b"] });
    // e.g. the chat box: Enter there sends a message, not a menu dismissal.
    const chatInput = document.createElement("input");
    document.body.appendChild(chatInput);
    pressEnterOn(chatInput);
    expect(wrapper.props("closeMenu")).not.toHaveBeenCalled();
    chatInput.remove();
    // Anywhere else (stage focus — Safari doesn't even focus clicked
    // buttons, so the keystroke often lands on <body>).
    pressEnterOn(document.body);
    expect(wrapper.props("closeMenu")).toHaveBeenCalled();
  });

  it("▶ starts with the armed speed, not the stale last speed", async () => {
    const wrapper = mountMenu({
      id: "m1",
      type: "avatar",
      multi: true,
      frames: ["a", "b"],
      lastAutoplayFrames: 1,
    });
    const input = wrapper.find("input.anmation-input");
    (input.element as HTMLInputElement).value = "4";
    await input.trigger("input");
    await wrapper.find('icon-stub[src="play.svg"]').trigger("click");
    expect(toggleAutoplayFrames).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1", autoplayFrames: 4 }),
    );
  });

  it("offers an explicit close item that only closes the menu", async () => {
    const wrapper = mountMenu({ id: "o4", type: "avatar" });
    const closeItem = wrapper.find("[data-testid='close-context-menu']");
    await closeItem.trigger("click");
    expect(wrapper.props("closeMenu")).toHaveBeenCalled();
    expect(shapeObject).not.toHaveBeenCalled();
  });
});
