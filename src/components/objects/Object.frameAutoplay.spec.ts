// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * Multiframe autoplay timer of the shared object wrapper (Object.vue) —
 * GitHub issue #1582 "multiframe animation speed doesn't work at 300 seconds".
 *
 * The store's `objects` getter rebuilds every board object (`{...o, holder}`)
 * whenever ANYTHING on stage changes: another object moves, someone joins or
 * leaves, or a client's 5-minute presence heartbeat lands. Each component then
 * receives a new `object` prop with identical contents. The autoplay watcher
 * used a single getter returning `[autoplayFrames, frameLoop]`; a fresh array
 * is always "changed", so the interval was torn down and restarted from zero
 * on every such update. A 2–30 s animation only stuttered now and then; a
 * 300 s one could never outlast the gaps between stage updates.
 *
 * Contract: only a real change of speed or loop flag restarts the run.
 */

vi.mock("config", () => ({ default: { STATIC_ASSETS_ENDPOINT: "" } }));
vi.mock("ant-design-vue", () => ({ message: { error: vi.fn() } }));

vi.mock("@stores/pinia/stage", async () => {
  const { reactive, ref } = await import("vue");
  const store = reactive({
    stageSize: ref({ left: 0, top: 0, width: 1000, height: 600 }),
    canPlay: ref(true),
    activeMovable: ref<string | null>(null),
    session: "session-1",
    currentAvatar: ref(null),
    shapeObject: vi.fn(),
    toggleAutoplayFrames: vi.fn(),
    streamLocalMuted: () => false,
    streamLocalVolume: () => 100,
    forceReloadStreams: ref(null),
  });
  return { useStageStore: () => store };
});
vi.mock("@stores/pinia/user", () => ({
  useUserStore: () => ({ avatarId: null, setAvatarId: vi.fn() }),
}));

import AppObject from "./Object.vue";
import { useStageStore } from "@stores/pinia/stage";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const PROP = {
  id: "prop-1",
  type: "prop",
  multi: true,
  frames: ["a.png", "b.png", "c.png"],
  src: "a.png",
  autoplayFrames: 300,
  x: 10,
  y: 10,
  w: 100,
  h: 100,
  rotate: 0,
  opacity: 1,
};

const mounted: Array<{ unmount: () => void }> = [];
function mountObject(object: Record<string, unknown>) {
  const w = mount(AppObject, {
    props: { object },
    global: {
      stubs: {
        ContextMenu: { template: "<div><slot name='trigger' /></div>" },
        Moveable: { template: "<div class='moveable-stub'><slot /></div>" },
        OpacitySlider: true,
        QuickAction: true,
        Topping: true,
        AppImage: { props: ["src"], template: "<img class='the-object' :data-src='src' />" },
      },
    },
  });
  mounted.push(w);
  return w;
}
const shown = (w: ReturnType<typeof mountObject>) => w.find(".the-object").attributes("data-src");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.mocked(useStageStore().toggleAutoplayFrames).mockClear();
});
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** What the store getter does on every unrelated stage change. */
const churn = async (w: ReturnType<typeof mountObject>, patch: Record<string, unknown> = {}) => {
  await w.setProps({ object: { ...(w.props("object") as object), ...patch } });
};

describe("multiframe autoplay at a long speed (#1582)", () => {
  it("changes frame after 300 s even though the object is rebuilt in between", async () => {
    const w = mountObject({ ...PROP });
    expect(shown(w)).toBe("a.png");

    // Unrelated stage updates every 20 s for the whole five minutes: the
    // prop itself is moved, and identical copies arrive (heartbeats).
    for (let t = 20; t < 300; t += 20) {
      vi.advanceTimersByTime(20_000);
      await churn(w, t % 40 === 0 ? { x: 10 + t } : {});
      expect(shown(w)).toBe("a.png");
    }
    vi.advanceTimersByTime(20_000);
    await nextTick();
    expect(shown(w)).toBe("b.png");

    vi.advanceTimersByTime(300_000);
    await nextTick();
    expect(shown(w)).toBe("c.png");
  });

  it("still restarts the run when the speed really changes", async () => {
    const w = mountObject({ ...PROP });
    vi.advanceTimersByTime(200_000);
    await churn(w, { autoplayFrames: 5 });
    vi.advanceTimersByTime(4_900);
    await nextTick();
    expect(shown(w)).toBe("a.png");
    vi.advanceTimersByTime(100);
    await nextTick();
    expect(shown(w)).toBe("b.png");
  });

  it("stops when autoplay is cleared and shows the object's own frame", async () => {
    const w = mountObject({ ...PROP });
    await churn(w, { autoplayFrames: null, src: "c.png" });
    vi.advanceTimersByTime(600_000);
    await nextTick();
    expect(shown(w)).toBe("c.png");
  });

  it("a play-once run survives churn and reports its end once", async () => {
    const w = mountObject({ ...PROP, frameLoop: false, autoplayFrames: 60 });
    for (let t = 0; t < 180; t += 15) {
      vi.advanceTimersByTime(15_000);
      await churn(w);
    }
    expect(shown(w)).toBe("c.png");
    expect(useStageStore().toggleAutoplayFrames).toHaveBeenCalledTimes(1);
    expect(useStageStore().toggleAutoplayFrames).toHaveBeenCalledWith(
      expect.objectContaining({ id: "prop-1", autoplayFrames: null, src: "c.png" }),
    );
  });
});
