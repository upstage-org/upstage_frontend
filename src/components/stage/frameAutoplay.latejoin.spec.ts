// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";

/**
 * "Latecomers see exactly what everyone else sees" (#1582 follow-up), end to
 * end in one process: the real stage store and the real Object, Backdrop and
 * Curtain components.
 *
 * Two seats are simulated with the same events. The EARLY seat is on stage
 * from the start and receives each event live. The LATE seat enters later
 * through `loadStage`, which hands it the archive of those same events. From
 * the moment the late seat is in, both must show the same frame of every
 * animation and change frame at the same instant, for as long as we watch.
 */

const { loadStage } = vi.hoisted(() => ({ loadStage: vi.fn() }));
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
vi.mock("@services/graphql", () => ({
  stageGraph: { loadStage, updateLastAccess: vi.fn(() => Promise.resolve()) },
  studioClient: {},
}));
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
    MQTT_NAMESPACE: "unit",
  },
}));

import AppObject from "../objects/Object.vue";
import Backdrop from "./Backdrop.vue";
import Curtain from "./Curtain.vue";
import { useStageStore, type ReplayEvent, type StageModel } from "@stores/pinia/stage";
import { __setServerClockOffsetForTests } from "@utils/serverClock";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const START_S = 1_800_000_000;
const A = "/resources/a.png";
const B = "/resources/b.png";
const C = "/resources/c.png";
const FRAMES = [A, B, C];

const prop = (extra: Record<string, unknown> = {}) => ({
  id: "p1",
  type: "prop",
  multi: true,
  frames: [...FRAMES],
  src: A,
  x: 0.1,
  y: 0.1,
  w: 0.1,
  h: 0.1,
  rotate: 0,
  opacity: 1,
  ...extra,
});

/** One stage, as one browser sees it: its own store and its own components. */
function seat() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useStageStore();
  store.UPDATE_VIEWPORT({ width: 1000, height: 600 });
  const Stage = defineComponent({
    setup() {
      const s = useStageStore();
      return () => [
        h(Backdrop),
        ...s.objects.map((o) => h(AppObject, { key: o.id as string, object: o })),
        h(Curtain),
      ];
    },
  });
  let wrapper: ReturnType<typeof mount> | null = null;
  return {
    store,
    mount() {
      setActivePinia(pinia);
      wrapper = mount(Stage, {
        global: {
          plugins: [pinia],
          stubs: {
            ContextMenu: { template: "<div class='ctx'><slot name='trigger' /></div>" },
            Moveable: { template: "<div class='moveable-stub'><slot /></div>" },
            OpacitySlider: true,
            QuickAction: true,
            Topping: true,
            AppImage: { props: ["src"], template: "<img class='app-image' :data-src='src' />" },
          },
        },
      });
    },
    /** Apply `fn` with this seat's store active (two stores share the module). */
    with<T>(fn: (s: ReturnType<typeof useStageStore>) => T): T {
      setActivePinia(pinia);
      return fn(store);
    },
    shows() {
      const w = wrapper!;
      return {
        prop: w.find(".ctx .app-image").exists()
          ? w.find(".ctx .app-image").attributes("data-src")
          : null,
        backdrop: w.find("#stage-backdrop .app-image").exists()
          ? w.find("#stage-backdrop .app-image").attributes("data-src")
          : null,
        // The newest <img>: during a crossfade the outgoing one is still there.
        curtain: w.findAll(".curtain-img").at(-1)?.attributes("src") ?? null,
      };
    },
    unmount() {
      wrapper?.unmount();
      wrapper = null;
    },
  };
}

let eventId = 0;
const archive: ReplayEvent[] = [];
/** Publish one stage event: the early seat gets it live, the archive keeps it. */
function publish(
  early: ReturnType<typeof seat>,
  topic: "board" | "background",
  payload: Record<string, unknown>,
) {
  archive.push({
    id: (eventId += 1),
    topic: `unit/demo/${topic}`,
    mqttTimestamp: Date.now() / 1000,
    payload: JSON.parse(JSON.stringify(payload)),
  } as ReplayEvent);
  early.with((s) =>
    s.handleMessage({ topic, message: JSON.parse(JSON.stringify(payload)) } as never),
  );
}

async function enterLate(late: ReturnType<typeof seat>) {
  // Let the early seat finish rendering first. Two Pinia instances share
  // this process, and a component render makes its own instance the active
  // one; `loadStage` resumes after an await and must still find the late
  // seat's store active (a real browser only ever has one).
  await nextTick();
  loadStage.mockResolvedValue({
    stage: {
      id: "1",
      fileLocation: "demo",
      assets: [],
      attributes: [],
      permission: "audience",
      status: "live",
      events: archive.map((e) => ({ ...e })),
    } as unknown as StageModel,
  });
  await late.with((s) => s.loadStage({ url: "demo" }));
  late.mount();
  await nextTick();
}

const seats: Array<ReturnType<typeof seat>> = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START_S * 1000);
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("offline"))),
  );
  __setServerClockOffsetForTests(0, true);
  loadStage.mockReset();
  archive.length = 0;
  eventId = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  seats.splice(0).forEach((s) => s.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  __setServerClockOffsetForTests(0, false);
});
const newSeat = () => {
  const s = seat();
  seats.push(s);
  return s;
};

/** Step both seats through `seconds`, comparing what they show every second. */
async function watchTogether(
  early: ReturnType<typeof seat>,
  late: ReturnType<typeof seat>,
  seconds: number,
) {
  const changes: Array<{ at: number; shows: ReturnType<ReturnType<typeof seat>["shows"]> }> = [];
  let last = JSON.stringify(early.shows());
  for (let t = 1; t <= seconds; t += 1) {
    vi.advanceTimersByTime(1000);
    await nextTick();
    const e = early.shows();
    expect(late.shows(), `after ${t}s`).toEqual(e);
    if (JSON.stringify(e) !== last) {
      last = JSON.stringify(e);
      changes.push({ at: t, shows: e });
    }
  }
  return changes;
}

describe("a prop animating at 300 s", () => {
  it("someone who arrives 100 s in changes frame together with everyone else", async () => {
    const early = newSeat();
    early.mount();
    publish(early, "board", { type: "placeObjectOnStage", object: prop() });
    vi.advanceTimersByTime(20_000);
    publish(early, "board", {
      type: "toggleAutoplayFrames",
      object: prop({ autoplayFrames: 300 }),
    });
    await nextTick();
    vi.advanceTimersByTime(100_000);
    await nextTick();

    const late = newSeat();
    await enterLate(late);
    expect(early.shows().prop).toBe(A);
    expect(late.shows().prop).toBe(A);

    const changes = await watchTogether(early, late, 520);
    // 200 s after the late arrival (300 s after the start), then 300 s on.
    expect(changes.map((c) => [c.at, c.shows.prop])).toEqual([
      [200, B],
      [500, C],
    ]);
  });

  it("someone who arrives after the first change is already on the second frame", async () => {
    const early = newSeat();
    early.mount();
    publish(early, "board", {
      type: "placeObjectOnStage",
      object: prop({ autoplayFrames: 300 }),
    });
    await nextTick();
    vi.advanceTimersByTime(430_000);
    await nextTick();
    expect(early.shows().prop).toBe(B);

    const late = newSeat();
    await enterLate(late);
    expect(late.shows().prop).toBe(B);
    const changes = await watchTogether(early, late, 200);
    expect(changes.map((c) => [c.at, c.shows.prop])).toEqual([[170, C]]);
  });

  it("stage activity before and after the arrival changes nothing for either seat", async () => {
    const early = newSeat();
    early.mount();
    publish(early, "board", { type: "placeObjectOnStage", object: prop() });
    publish(early, "board", {
      type: "placeObjectOnStage",
      object: prop({ id: "other", multi: false, src: C }),
    });
    publish(early, "board", {
      type: "toggleAutoplayFrames",
      object: prop({ autoplayFrames: 300 }),
    });
    for (let t = 0; t < 120; t += 30) {
      vi.advanceTimersByTime(30_000);
      publish(early, "board", {
        type: "moveTo",
        object: prop({ autoplayFrames: 300, x: t / 1000 }),
      });
    }
    const late = newSeat();
    await enterLate(late);
    for (let t = 0; t < 150; t += 30) {
      vi.advanceTimersByTime(30_000);
      const move = { type: "moveTo", object: prop({ autoplayFrames: 300, x: 0.3 + t / 1000 }) };
      publish(early, "board", move);
      late.with((s) =>
        s.handleMessage({ topic: "board", message: structuredClone(move) } as never),
      );
      for (const seatUnderTest of [early, late]) {
        seatUnderTest.with((s) =>
          s.UPDATE_SESSIONS_COUNTER({
            id: `viewer-${t}`,
            isPlayer: false,
            at: Date.now(),
          } as never),
        );
      }
      await nextTick();
      expect(late.shows()).toEqual(early.shows());
    }
    // 270 s since the start: still the first frame; 30 s more and it changes.
    expect(early.shows().prop).toBe(A);
    const changes = await watchTogether(early, late, 40);
    expect(changes.map((c) => [c.at, c.shows.prop])).toEqual([[30, B]]);
  });

  it("a play-once run that ended before the arrival is over for the latecomer too", async () => {
    const early = newSeat();
    early.mount();
    publish(early, "board", {
      type: "placeObjectOnStage",
      object: prop({ autoplayFrames: 10, frameLoop: false, liveAction: false }),
    });
    await nextTick();
    vi.advanceTimersByTime(45_000);
    await nextTick();
    // The early seat finished the run itself (3 frames, 10 s each).
    expect(early.with((s) => s.board.objects[0].autoplayFrames)).toBeNull();
    expect(early.shows().prop).toBe(C);

    const late = newSeat();
    await enterLate(late);
    await nextTick();
    expect(late.shows().prop).toBe(C);
    expect(late.with((s) => s.board.objects[0].autoplayFrames)).toBeNull();
    expect(late.with((s) => s.frameRuns.p1)).toBeUndefined();
  });
});

describe("animated backdrop and curtain", () => {
  it("a latecomer is on the same backdrop and curtain frame, and stays in step", async () => {
    const early = newSeat();
    early.mount();
    publish(early, "background", {
      type: "changeBackground",
      background: {
        id: 5,
        src: A,
        multi: true,
        frames: FRAMES,
        speed: 1,
        dwell: 299,
        opacity: 1,
        at: Date.now(),
      },
    });
    vi.advanceTimersByTime(50_000);
    publish(early, "background", {
      type: "drawCurtain",
      curtain: { id: 6, src: A, multi: true, frames: FRAMES, speed: 2, dwell: 58, at: Date.now() },
    });
    await nextTick();
    vi.advanceTimersByTime(370_000);
    await nextTick();
    // Backdrop: 420 s in at 300 s a step → second frame. Curtain: 370 s in
    // at 60 s a step → six steps → back on the first frame.
    expect(early.shows()).toMatchObject({ backdrop: B, curtain: A });

    const late = newSeat();
    await enterLate(late);
    expect(late.shows()).toEqual(early.shows());

    const changes = await watchTogether(early, late, 200);
    expect(changes.map((c) => [c.at, c.shows.backdrop, c.shows.curtain])).toEqual([
      [50, B, B],
      [110, B, C],
      [170, B, A],
      [180, C, A],
    ]);
  });

  it("opacity changes made before the arrival do not move the latecomer's timing", async () => {
    const early = newSeat();
    early.mount();
    const background = {
      id: 5,
      src: A,
      multi: true,
      frames: FRAMES,
      speed: 1,
      dwell: 299,
      opacity: 1,
    };
    publish(early, "background", {
      type: "changeBackground",
      background: { ...background, at: Date.now() },
    });
    for (let i = 1; i <= 5; i += 1) {
      vi.advanceTimersByTime(40_000);
      publish(early, "background", {
        type: "changeBackground",
        background: { ...background, opacity: 1 - i / 10, at: Date.now() },
      });
    }
    await nextTick();
    const late = newSeat();
    await enterLate(late);
    expect(late.shows()).toEqual(early.shows());
    const changes = await watchTogether(early, late, 120);
    // Started 200 s before the arrival → first change 100 s after it.
    expect(changes.map((c) => [c.at, c.shows.backdrop])).toEqual([[100, B]]);
  });
});

describe("a latecomer whose computer clock is wrong", () => {
  it("is still in step once the offset to the server is known", async () => {
    const early = newSeat();
    early.mount();
    publish(early, "board", {
      type: "placeObjectOnStage",
      object: prop({ autoplayFrames: 300 }),
    });
    await nextTick();
    vi.advanceTimersByTime(100_000);
    await nextTick();

    // The late computer runs 25 s behind the server. Its own `Date.now()`
    // is what the fake clock returns, so shift the archive the other way:
    // seen from that computer, every server stamp is 25 s in its future.
    archive.forEach((e) => {
      e.mqttTimestamp += 25;
    });
    __setServerClockOffsetForTests(25_000, true);
    const late = newSeat();
    await enterLate(late);
    const changes = await watchTogether(early, late, 210);
    expect(changes.map((c) => [c.at, c.shows.prop])).toEqual([[200, B]]);
  });
});
