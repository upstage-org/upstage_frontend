// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";

/**
 * Backdrop companion to #1582 ("multiframe animation speed doesn't work at
 * 300 seconds"). A multiframe backdrop's cycle is `speed + dwell` seconds.
 * Every published copy of the backdrop replaces `stageStore.background`, and
 * the opacity slider publishes one every 100 ms while dragged — each used to
 * restart the cycle from zero and snap the picture back to the stored
 * `currentFrame`. Opacity-only updates must leave a running cycle alone;
 * every other update restarts it exactly as before.
 */

const store = reactive<{ background: Record<string, unknown> | null; setBackground: unknown }>({
  background: null,
  setBackground: vi.fn(),
});
vi.mock("@stores/pinia/stage", () => ({ useStageStore: () => store }));

import Backdrop from "./Backdrop.vue";

const FRAMES = ["a.png", "b.png", "c.png"];
const BG = { id: 1, src: "a.png", multi: true, frames: FRAMES, speed: 1, dwell: 299, opacity: 1 };

let at = 1000;
/** What SET_BACKGROUND does with each accepted message: replace the ref. */
const publish = async (patch: Record<string, unknown> = {}) => {
  store.background = { ...(store.background ?? BG), ...patch, at: (at += 1) };
  await nextTick();
};

let wrapper: ReturnType<typeof mount> | null = null;
const mountBackdrop = () => {
  wrapper = mount(Backdrop, {
    global: {
      stubs: { AppImage: { props: ["src"], template: "<img class='bg' :data-src='src' />" } },
    },
  });
  return wrapper;
};
const shown = () => wrapper!.find(".bg").attributes("data-src");

beforeEach(() => {
  vi.useFakeTimers();
  store.background = { ...BG, at: (at += 1) };
  vi.mocked(store.setBackground as ReturnType<typeof vi.fn>).mockClear();
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
});

describe("multiframe backdrop with a 300 s cycle", () => {
  it("advances after speed + dwell seconds", async () => {
    mountBackdrop();
    expect(shown()).toBe("a.png");
    vi.advanceTimersByTime(299_999);
    await nextTick();
    expect(shown()).toBe("a.png");
    vi.advanceTimersByTime(1);
    await nextTick();
    expect(shown()).toBe("b.png");
  });

  it("starting playback on a static backdrop keeps its picture up (no blank first cycle)", async () => {
    store.background = { ...BG, speed: 0, dwell: 0, at: (at += 1) };
    mountBackdrop();
    expect(shown()).toBe("a.png");
    await publish({ speed: 1, dwell: 299 });
    expect(shown()).toBe("a.png");
    vi.advanceTimersByTime(300_000);
    await nextTick();
    expect(shown()).toBe("b.png");
  });

  it("switching to another animated backdrop never shows the old one's frame", async () => {
    mountBackdrop();
    vi.advanceTimersByTime(300_000);
    await nextTick();
    expect(shown()).toBe("b.png");
    store.background = {
      id: 2,
      src: "x.png",
      multi: true,
      frames: ["x.png", "y.png"],
      speed: 1,
      dwell: 299,
      at: (at += 1),
    };
    await nextTick();
    expect(shown()).toBe("x.png");
    vi.advanceTimersByTime(300_000);
    await nextTick();
    expect(shown()).toBe("y.png");
  });

  it("a speed change mid-strip keeps the frame it had reached", async () => {
    mountBackdrop();
    vi.advanceTimersByTime(300_000);
    await nextTick();
    expect(shown()).toBe("b.png");
    await publish({ dwell: 9 });
    expect(shown()).toBe("b.png");
    vi.advanceTimersByTime(10_000);
    await nextTick();
    expect(shown()).toBe("c.png");
  });

  it("opacity changes mid-cycle do not restart the timer", async () => {
    mountBackdrop();
    vi.advanceTimersByTime(200_000);
    for (let i = 1; i <= 5; i++) {
      await publish({ opacity: 1 - i * 0.1 });
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(99_500);
    await nextTick();
    expect(shown()).toBe("b.png");
  });

  it("an opacity change does not snap back to the stored currentFrame", async () => {
    store.background = { ...BG, currentFrame: "a.png", at: (at += 1) };
    mountBackdrop();
    vi.advanceTimersByTime(300_000);
    await nextTick();
    expect(shown()).toBe("b.png");
    await publish({ opacity: 0.5 });
    expect(shown()).toBe("b.png");
    vi.advanceTimersByTime(300_000);
    await nextTick();
    expect(shown()).toBe("c.png");
  });

  it.each([
    ["speed", { speed: 2 }],
    ["dwell", { dwell: 100 }],
    ["loop flag", { frameLoop: false }],
  ])("a %s change still restarts the cycle", async (_name, patch) => {
    mountBackdrop();
    vi.advanceTimersByTime(200_000);
    await publish(patch);
    const next = { ...BG, ...patch } as typeof BG;
    const cycle = (next.speed + next.dwell) * 1000;
    vi.advanceTimersByTime(cycle - 1);
    await nextTick();
    expect(shown()).toBe("a.png");
    vi.advanceTimersByTime(1);
    await nextTick();
    expect(shown()).toBe("b.png");
  });

  it("picking a frame still jumps to it and restarts", async () => {
    mountBackdrop();
    vi.advanceTimersByTime(200_000);
    await publish({ currentFrame: "c.png" });
    expect(shown()).toBe("c.png");
    vi.advanceTimersByTime(300_000);
    await nextTick();
    expect(shown()).toBe("a.png");
  });

  it("pausing (speed 0) stops the cycle; a later opacity change keeps it stopped", async () => {
    mountBackdrop();
    await publish({ speed: 0, dwell: 0, currentFrame: "b.png" });
    expect(shown()).toBe("b.png");
    await publish({ opacity: 0.3 });
    vi.advanceTimersByTime(900_000);
    await nextTick();
    expect(shown()).toBe("b.png");
  });

  it("a play-once run ends on the last frame and reports it once, opacity drags included", async () => {
    store.background = { ...BG, frameLoop: false, at: (at += 1) };
    mountBackdrop();
    vi.advanceTimersByTime(300_000);
    await publish({ opacity: 0.8 });
    vi.advanceTimersByTime(300_000);
    await nextTick();
    expect(shown()).toBe("c.png");
    vi.advanceTimersByTime(300_000);
    expect(store.setBackground).toHaveBeenCalledTimes(1);
    expect(store.setBackground).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 0, currentFrame: "c.png" }),
    );
  });
});
