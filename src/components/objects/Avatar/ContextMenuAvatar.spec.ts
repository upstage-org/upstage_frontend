// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

/**
 * Live stream tiles (jitsi + RTMP) no longer pass through this menu — they
 * use the standardised ContextMenuStream (see Avatar/index.vue and
 * Jitsi.vue). This menu keeps serving avatars, props and stream-playback
 * VIDEO FILES, whose transport controls (play/pause/restart/loop) must
 * survive the split.
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

describe("ContextMenuAvatar after the stream-menu split", () => {
  it("keeps the video-file transport controls (play/restart/volume/loop)", () => {
    const wrapper = mountMenu({ id: "v1", type: "video", name: "clip", isPlaying: false });
    const text = wrapper.text();
    expect(text).toContain("play");
    expect(text).toContain("restart");
    expect(text).toContain("volumn_setting");
    expect(text).toContain("loop.off");
  });

  it("offers no frame-shape row (that row lives in ContextMenuStream)", () => {
    expect(mountMenu({ id: "o4", type: "avatar" }).findAll("[data-testid^='shape-']")).toHaveLength(
      0,
    );
    expect(
      mountMenu({ id: "v1", type: "video", name: "clip" }).findAll("[data-testid^='shape-']"),
    ).toHaveLength(0);
  });

  it("keeps the exit-animation override for props/avatars", () => {
    expect(mountMenu({ id: "o4", type: "avatar" }).text()).toContain("exit_setting");
  });
});
