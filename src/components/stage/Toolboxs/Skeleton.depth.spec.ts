// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * Depth-bar rollover (`showMovable`) contract.
 *
 * Rolling over an item in the Depth list brings up the on-stage
 * manipulation frame for every object EXCEPT an avatar currently held by
 * another player. In particular an UNHELD avatar must get the frame — the
 * Depth bar is the only way to reach an avatar buried under other objects
 * (to hold it, or to clear one abandoned by a disconnected player). A
 * regression ("various fixes", d2056cc) restricted the frame to avatars
 * this player already holds; these tests pin the restored behavior.
 */

const { SET_ACTIVE_MOVABLE, userState } = vi.hoisted(() => ({
  SET_ACTIVE_MOVABLE: vi.fn(),
  userState: { avatarId: null as string | null },
}));

vi.mock("@stores/pinia/stage", () => ({
  useStageStore: () => ({
    SET_ACTIVE_MOVABLE,
    canPlay: true,
    session: "my-session",
    stageSize: { width: 1000, height: 562, left: 0, top: 0 },
    placeObjectOnStage: vi.fn((o: Record<string, unknown>) => ({ id: o.id ?? "placed" })),
    autoFocusMoveable: vi.fn(),
    REORDER_TOOLBOX: vi.fn(),
    bringToFrontOf: vi.fn(),
  }),
}));
// Skeleton imports `useDragHoldShim` from composables/index, which pulls in
// useAvatarSpeech → the meSpeak-backed speech service that reads
// `window.meSpeak` at module scope (absent under jsdom).
vi.mock("@services/speech", () => ({
  avatarSpeak: vi.fn(),
  stopSpeaking: vi.fn(),
}));
vi.mock("@stores/pinia/user", () => ({
  useUserStore: () => ({
    avatarId: userState.avatarId,
    setAvatarId: vi.fn(),
  }),
}));

import Skeleton from "./Skeleton.vue";

const mountSkeleton = (data: Record<string, unknown>, real = true) =>
  mount(Skeleton, {
    props: { data, real },
    global: {
      stubs: {
        // ant-design-vue tooltip is registered app-wide in main.ts; render
        // its default slot so the inner .skeleton div stays reachable.
        "a-tooltip": { template: "<span><slot /></span>" },
        Icon: true,
        AppImage: true,
        SavedDrawing: true,
      },
    },
  });

const rollOver = async (data: Record<string, unknown>, real = true) => {
  const wrapper = mountSkeleton(data, real);
  await wrapper.find(".skeleton").trigger("mouseenter");
  wrapper.unmount();
};

beforeEach(() => {
  vi.clearAllMocks();
  userState.avatarId = null;
});

describe("Depth-bar rollover (showMovable)", () => {
  it("an UNHELD avatar gets the manipulation frame", async () => {
    await rollOver({ id: "a1", type: "avatar" });
    expect(SET_ACTIVE_MOVABLE).toHaveBeenCalledWith("a1");
  });

  it("an avatar held by ANOTHER player does not", async () => {
    await rollOver({ id: "a1", type: "avatar", holder: { id: "other-session" } });
    expect(SET_ACTIVE_MOVABLE).not.toHaveBeenCalled();
  });

  it("an avatar held by THIS tab (session match) does", async () => {
    await rollOver({ id: "a1", type: "avatar", holder: { id: "my-session" } });
    expect(SET_ACTIVE_MOVABLE).toHaveBeenCalledWith("a1");
  });

  it("an avatar held by THIS user (avatarId match) does", async () => {
    userState.avatarId = "a1";
    await rollOver({ id: "a1", type: "avatar", holder: { id: "other-session" } });
    expect(SET_ACTIVE_MOVABLE).toHaveBeenCalledWith("a1");
  });

  it("non-holdable objects (props, streams, text) always get the frame", async () => {
    await rollOver({ id: "p1", type: "prop" });
    await rollOver({ id: "s1", type: "video", name: "feedkey" });
    await rollOver({ id: "t1", type: "text", content: "hi" });
    expect(SET_ACTIVE_MOVABLE.mock.calls.map((c) => c[0])).toEqual(["p1", "s1", "t1"]);
  });

  it("toolbox (non-real) items never touch the selection", async () => {
    await rollOver({ id: "a1", type: "avatar" }, false);
    expect(SET_ACTIVE_MOVABLE).not.toHaveBeenCalled();
  });
});
