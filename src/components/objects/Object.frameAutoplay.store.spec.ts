// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";

/**
 * #1582 end to end through the REAL stage store: a multiframe prop set to
 * 300 s must change frame after 300 s while the stage carries on around it.
 *
 * Object.frameAutoplay.spec.ts pins the component contract with hand-made
 * prop churn; this file proves the churn is real — that the store's
 * `objects` getter really does hand the component a new object when a
 * presence heartbeat arrives or another object moves — and that the timer
 * survives it, rendered the way Board.vue renders (v-for over store.objects).
 */

vi.mock("@services/mqtt", () => ({
  default: () => ({
    connect: vi.fn(),
    whenConnected: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => Promise.resolve()),
    sendMessage: vi.fn(() => Promise.resolve()),
    sendMessageSync: vi.fn(),
    receiveMessage: vi.fn(),
  }),
}));
vi.mock("@services/speech", () => ({ avatarSpeak: vi.fn(), stopSpeaking: vi.fn() }));
vi.mock("ant-design-vue", () => ({ message: { error: vi.fn() } }));
vi.mock("config", () => ({
  default: {
    STATIC_ASSETS_ENDPOINT: "/resources/",
    JITSI_ENDPOINT: "https://j1.test",
    JITSI_ENDPOINTS: ["https://j1.test"],
    JITSI_SERVER_COUNT: 1,
    RTMP_ENDPOINT: "",
    RTMP_ENDPOINTS: [] as string[],
    RTMP_SERVER_COUNT: 0,
    MQTT_CONNECTION: {},
  },
}));

import AppObject from "./Object.vue";
import { useStageStore } from "@stores/pinia/stage";
import { serializeObject } from "@stores/modules/stage/reusable";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const FRAMES = ["/resources/a.png", "/resources/b.png", "/resources/c.png"];
const base = { x: 100, y: 100, w: 100, h: 100, rotate: 0, opacity: 1 };

// Board.vue in miniature: one wrapper per entry of the store getter.
const Board = defineComponent({
  setup() {
    const store = useStageStore();
    return () =>
      store.objects.map((o) => h(AppObject, { key: o.id as string, id: o.id, object: o }));
  },
});

let wrapper: ReturnType<typeof mount> | null = null;
const mountBoard = () => {
  wrapper = mount(Board, {
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
  return wrapper;
};
const shown = (id: string) =>
  wrapper!.find(`#${id} .the-object, [id="${id}"] .the-object`).attributes("data-src");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  setActivePinia(createPinia());
  const s = useStageStore();
  s.UPDATE_VIEWPORT({ width: 1000, height: 600 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  s.board.objects.push(
    {
      ...base,
      id: "slow",
      type: "prop",
      multi: true,
      frames: [...FRAMES],
      src: FRAMES[0],
      autoplayFrames: 300,
    } as never,
    { ...base, id: "other", type: "prop", src: "/resources/x.png", x: 400 } as never,
  );
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const heartbeat = (id: string) =>
  useStageStore().UPDATE_SESSIONS_COUNTER({ id, isPlayer: true, at: Date.now() } as never);

describe("300 s multiframe prop on a live stage (#1582)", () => {
  it("premise: a heartbeat or another object's move rebuilds the prop's object", () => {
    const s = useStageStore();
    const before = s.objects.find((o) => o.id === "slow");
    heartbeat("player-1");
    const afterHeartbeat = s.objects.find((o) => o.id === "slow");
    expect(afterHeartbeat).not.toBe(before);
    expect(afterHeartbeat).toEqual(before);

    s.UPDATE_OBJECT(serializeObject({ ...base, id: "other", type: "prop", x: 500 } as never));
    const afterMove = s.objects.find((o) => o.id === "slow");
    expect(afterMove).not.toBe(afterHeartbeat);
    expect((afterMove as Record<string, unknown>).autoplayFrames).toBe(300);
  });

  it("changes frame at 300 s despite heartbeats, joins and other objects moving", async () => {
    const s = useStageStore();
    mountBoard();
    await nextTick();
    expect(shown("slow")).toBe(FRAMES[0]);

    for (let t = 30; t < 300; t += 30) {
      vi.advanceTimersByTime(30_000);
      if (t % 60 === 0) heartbeat(`player-${t}`);
      else
        s.UPDATE_OBJECT(
          serializeObject({ ...base, id: "other", type: "prop", x: 400 + t } as never),
        );
      await nextTick();
      expect(shown("slow")).toBe(FRAMES[0]);
    }
    vi.advanceTimersByTime(29_999);
    await nextTick();
    expect(shown("slow")).toBe(FRAMES[0]);
    vi.advanceTimersByTime(1);
    await nextTick();
    expect(shown("slow")).toBe(FRAMES[1]);
  });

  it("keeps its timing when the animated prop itself is moved mid-interval", async () => {
    const s = useStageStore();
    mountBoard();
    await nextTick();
    vi.advanceTimersByTime(250_000);
    const live = s.board.objects.find((o) => o.id === "slow")!;
    s.UPDATE_OBJECT(serializeObject({ ...live, x: 300, y: 200 } as never));
    await nextTick();
    vi.advanceTimersByTime(50_000);
    await nextTick();
    expect(shown("slow")).toBe(FRAMES[1]);
  });

  it("a new speed from the store restarts the run with that speed", async () => {
    const s = useStageStore();
    mountBoard();
    await nextTick();
    vi.advanceTimersByTime(100_000);
    const live = s.board.objects.find((o) => o.id === "slow")!;
    s.UPDATE_OBJECT(serializeObject({ ...live, autoplayFrames: 10 } as never));
    await nextTick();
    vi.advanceTimersByTime(10_000);
    await nextTick();
    expect(shown("slow")).toBe(FRAMES[1]);
  });
});
