// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * The crossfade ("fade (s)") and hold ("hold (s)") fields in a backdrop's
 * context menu only drive multi-frame animation. On a single-frame
 * backdrop `speed` has nothing to act on, so the field must not appear
 * there (2026-09-11 report: players expected it to do something).
 */

const store = {
  background: { id: 1, name: "single", src: "/single.png", speed: 0 },
  tools: {
    backdrops: [
      { id: 1, name: "single", src: "/single.png" },
      { id: 2, name: "multi", src: "/multi.png", multi: true, frames: ["/a.png", "/b.png"] },
    ],
  },
  setBackground: vi.fn(),
};

vi.mock("@stores/pinia/stage", () => ({ useStageStore: () => store }));
// Skeleton imports `useDragHoldShim` from composables/index, which pulls in
// the meSpeak-backed speech service that reads `window.meSpeak` at module
// scope (absent under jsdom) — same stub as Skeleton.depth.spec.ts.
vi.mock("@services/speech", () => ({ avatarSpeak: vi.fn(), stopSpeaking: vi.fn() }));
vi.mock("@stores/pinia/user", () => ({
  useUserStore: () => ({ avatarId: null, setAvatarId: vi.fn() }),
}));

import Backdrops from "./Backdrops.vue";

const mountTool = (activeId: number) => {
  store.background = { ...store.tools.backdrops[activeId - 1], speed: 0 };
  return mount(Backdrops, {
    global: {
      mocks: { $t: (key: string) => key },
      stubs: {
        // Render the context slot unconditionally: the real ContextMenu
        // only shows it once opened, which is not what is under test.
        ContextMenu: {
          template: '<div class="menu"><slot name="trigger" /><slot name="context" /></div>',
        },
        Skeleton: { template: "<div><slot /></div>" },
        AppImage: true,
        Icon: true,
      },
    },
  });
};

const menuFor = (wrapper: ReturnType<typeof mountTool>, index: number) =>
  wrapper.findAll(".menu")[index];

describe("Backdrops context menu timing fields", () => {
  it("hides the crossfade and hold fields on the active single-frame backdrop", () => {
    const menu = menuFor(mountTool(1), 0);
    expect(menu.find('input[placeholder="fade (s)"]').exists()).toBe(false);
    expect(menu.find('input[placeholder="hold (s)"]').exists()).toBe(false);
    // The opacity control is unaffected.
    expect(menu.find('input[type="range"]').exists()).toBe(true);
  });

  it("shows both fields on the active multi-frame backdrop", () => {
    const menu = menuFor(mountTool(2), 1);
    expect(menu.find('input[placeholder="fade (s)"]').exists()).toBe(true);
    expect(menu.find('input[placeholder="hold (s)"]').exists()).toBe(true);
  });

  it("shows neither field on a multi-frame backdrop that is not the active one", () => {
    const menu = menuFor(mountTool(1), 1);
    expect(menu.find('input[placeholder="fade (s)"]').exists()).toBe(false);
    expect(menu.find('input[placeholder="hold (s)"]').exists()).toBe(false);
  });
});
