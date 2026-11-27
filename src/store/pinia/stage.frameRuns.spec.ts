// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Shared start time of multiframe animations (#1582 follow-up: "latecomers
 * see exactly what everyone else sees").
 *
 * The store records when each animation run started (`frameRuns`); the
 * components work the frame out from that. These tests pin WHEN a run is
 * taken to have started on every path a stage state can arrive by:
 *   - a live message: now;
 *   - the archive a late joiner (or a reload) is caught up from: when the
 *     event happened, by the server's clock;
 *   - events missed during a disconnect: likewise;
 *   - a recording replayed from a point after the event: that far back in
 *     the recording's own time;
 *   - a scene change: the moment of the change, for every animation in it;
 * and what does and does not start a new run.
 */

const { loadStage, loadEvents } = vi.hoisted(() => ({ loadStage: vi.fn(), loadEvents: vi.fn() }));
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
  stageGraph: { loadStage, loadEvents, updateLastAccess: vi.fn(() => Promise.resolve()) },
  studioClient: {},
}));
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

import { useStageStore, type ReplayEvent, type StageModel } from "./stage";
import { BACKGROUND_RUN, CURTAIN_RUN, framePosition, layerCycleMs } from "@utils/frameAnimation";
import { __setServerClockOffsetForTests } from "@utils/serverClock";

/** Wall-clock "now" of every test, in seconds (archive timestamps are seconds). */
const NOW_S = 1_800_000_000;
const NOW = NOW_S * 1000;
const FRAMES = ["/resources/a.png", "/resources/b.png", "/resources/c.png"];

const prop = (extra: Record<string, unknown> = {}) => ({
  id: "p1",
  type: "prop",
  multi: true,
  frames: [...FRAMES],
  src: FRAMES[0],
  x: 0.1,
  y: 0.1,
  w: 0.1,
  h: 0.1,
  rotate: 0,
  opacity: 1,
  ...extra,
});

let eventId = 0;
const boardEvent = (at: number, type: string, object: Record<string, unknown>): ReplayEvent =>
  ({
    id: (eventId += 1),
    topic: "unit/demo/board",
    mqttTimestamp: at,
    payload: { type, object },
  }) as ReplayEvent;
const backgroundEvent = (at: number, payload: Record<string, unknown>): ReplayEvent =>
  ({
    id: (eventId += 1),
    topic: "unit/demo/background",
    mqttTimestamp: at,
    payload,
  }) as ReplayEvent;

const model = (events: ReplayEvent[], extra: Record<string, unknown> = {}): StageModel =>
  ({
    id: "1",
    fileLocation: "demo",
    assets: [],
    attributes: [],
    permission: "player",
    status: "live",
    events,
    ...extra,
  }) as unknown as StageModel;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setActivePinia(createPinia());
  loadStage.mockReset();
  loadEvents.mockReset();
  eventId = 0;
  __setServerClockOffsetForTests(0, true);
  // The clock measurement must not reach for the network in unit tests.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("offline"))),
  );
  useStageStore().UPDATE_VIEWPORT({ width: 1000, height: 600 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  __setServerClockOffsetForTests(0, false);
});

const live = (type: string, object: Record<string, unknown>) =>
  useStageStore().handleBoardMessage({ message: { type, object } as never });

describe("live messages", () => {
  it("a run starts when the speed arrives, from the object's picture", () => {
    const s = useStageStore();
    live("placeObjectOnStage", prop());
    expect(s.frameRuns.p1).toBeUndefined();
    vi.advanceTimersByTime(5_000);
    live("toggleAutoplayFrames", prop({ autoplayFrames: 300 }));
    expect(s.frameRuns.p1).toMatchObject({ startedAt: NOW + 5_000, fromFrame: FRAMES[0] });
  });

  it("an object placed already animating starts its run on arrival", () => {
    live("placeObjectOnStage", prop({ autoplayFrames: 300, src: FRAMES[1] }));
    expect(useStageStore().frameRuns.p1).toMatchObject({ startedAt: NOW, fromFrame: FRAMES[1] });
  });

  it("moves, resizes, echoes and heartbeats leave the run exactly as it was", () => {
    const s = useStageStore();
    live("placeObjectOnStage", prop());
    live("toggleAutoplayFrames", prop({ autoplayFrames: 300 }));
    const run = { ...s.frameRuns.p1 };
    for (let i = 1; i <= 20; i += 1) {
      vi.advanceTimersByTime(10_000);
      live("moveTo", prop({ autoplayFrames: 300, x: 0.1 + i / 100 }));
      live("toggleAutoplayFrames", prop({ autoplayFrames: 300 })); // broker echo
      s.UPDATE_SESSIONS_COUNTER({ id: `v${i}`, isPlayer: false, at: Date.now() } as never);
    }
    expect(s.frameRuns.p1).toEqual(run);
  });

  it.each([
    ["a different speed", { autoplayFrames: 30 }],
    ["the loop flag", { autoplayFrames: 300, frameLoop: false }],
    ["the same speed committed again (new run id)", { autoplayFrames: 300, autoplayRunId: 2 }],
  ])("%s starts a new run at that moment", (_name, patch) => {
    const s = useStageStore();
    live("placeObjectOnStage", prop());
    live("toggleAutoplayFrames", prop({ autoplayFrames: 300, autoplayRunId: 1 }));
    const first = s.frameRuns.p1.token;
    vi.advanceTimersByTime(120_000);
    live("toggleAutoplayFrames", prop(patch));
    expect(s.frameRuns.p1.startedAt).toBe(NOW + 120_000);
    expect(s.frameRuns.p1.token).not.toBe(first);
  });

  it("pausing or removing the object ends the run; playing again starts a new one", () => {
    const s = useStageStore();
    live("placeObjectOnStage", prop());
    live("toggleAutoplayFrames", prop({ autoplayFrames: 300 }));
    live("toggleAutoplayFrames", prop({ autoplayFrames: null, src: FRAMES[2] }));
    expect(s.frameRuns.p1).toBeUndefined();
    vi.advanceTimersByTime(7_000);
    live("toggleAutoplayFrames", prop({ autoplayFrames: 300, src: FRAMES[2] }));
    expect(s.frameRuns.p1).toMatchObject({ startedAt: NOW + 7_000, fromFrame: FRAMES[2] });
    live("destroy", prop());
    expect(s.frameRuns.p1).toBeUndefined();
  });

  it("an update for an object that is not on the board is ignored", () => {
    live("toggleAutoplayFrames", prop({ autoplayFrames: 300 }));
    expect(useStageStore().frameRuns.p1).toBeUndefined();
  });

  it("a non-multiframe object never gets a run", () => {
    live("placeObjectOnStage", prop({ multi: false, autoplayFrames: 300 }));
    expect(useStageStore().frameRuns.p1).toBeUndefined();
  });

  it("leaving the stage forgets every run", () => {
    const s = useStageStore();
    live("placeObjectOnStage", prop({ autoplayFrames: 300 }));
    expect(s.frameRuns.p1).toBeDefined();
    s.CLEAN_STAGE(true);
    expect(s.frameRuns).toEqual({});
  });
});

describe("joining late (stage state caught up from the archive)", () => {
  const enter = async (events: ReplayEvent[], extra: Record<string, unknown> = {}) => {
    loadStage.mockResolvedValue({ stage: model(events, extra) });
    const s = useStageStore();
    await s.loadStage({ url: "demo" });
    return s;
  };

  it("a run that began 100 s before arrival began 100 s ago", async () => {
    const s = await enter([
      boardEvent(NOW_S - 500, "placeObjectOnStage", prop()),
      boardEvent(NOW_S - 100, "toggleAutoplayFrames", prop({ autoplayFrames: 300 })),
    ]);
    expect(s.frameRuns.p1.startedAt).toBe(NOW - 100_000);
    // …so the first change is 200 s away, not 300.
    const position = framePosition(FRAMES, s.frameRuns.p1.fromFrame, undefined, 300_000, 100_000);
    expect(position).toMatchObject({ frame: FRAMES[0], nextChangeInMs: 200_000 });
  });

  it("everything that happened on stage after the start leaves the start alone", async () => {
    const s = await enter([
      boardEvent(NOW_S - 900, "placeObjectOnStage", prop()),
      boardEvent(NOW_S - 400, "toggleAutoplayFrames", prop({ autoplayFrames: 300 })),
      boardEvent(NOW_S - 350, "moveTo", prop({ autoplayFrames: 300, x: 0.5 })),
      boardEvent(NOW_S - 90, "moveTo", prop({ autoplayFrames: 300, x: 0.7 })),
      boardEvent(NOW_S - 5, "placeObjectOnStage", prop({ id: "p2", multi: false })),
    ]);
    expect(s.frameRuns.p1.startedAt).toBe(NOW - 400_000);
    const elapsed = Date.now() - s.frameRuns.p1.startedAt;
    expect(framePosition(FRAMES, FRAMES[0], undefined, 300_000, elapsed)).toMatchObject({
      frame: FRAMES[1],
      nextChangeInMs: 200_000,
    });
  });

  it("the most recent speed change is the one that counts", async () => {
    const s = await enter([
      boardEvent(NOW_S - 950, "placeObjectOnStage", prop()),
      boardEvent(NOW_S - 900, "toggleAutoplayFrames", prop({ autoplayFrames: 30 })),
      boardEvent(NOW_S - 250, "toggleAutoplayFrames", prop({ autoplayFrames: 300 })),
    ]);
    expect(s.frameRuns.p1.startedAt).toBe(NOW - 250_000);
  });

  it("an animation paused before arrival is not running", async () => {
    const s = await enter([
      boardEvent(NOW_S - 900, "placeObjectOnStage", prop()),
      boardEvent(NOW_S - 400, "toggleAutoplayFrames", prop({ autoplayFrames: 300 })),
      boardEvent(NOW_S - 60, "toggleAutoplayFrames", prop({ autoplayFrames: null })),
    ]);
    expect(s.frameRuns.p1).toBeUndefined();
  });

  it("uses the server's clock, not this computer's, to tell how long ago", async () => {
    // This computer is 40 s slow: the server's "now" is 40 s later.
    __setServerClockOffsetForTests(40_000, true);
    const s = await enter([
      boardEvent(NOW_S - 900, "placeObjectOnStage", prop()),
      boardEvent(NOW_S - 60, "toggleAutoplayFrames", prop({ autoplayFrames: 300 })),
    ]);
    // 100 s ago in real terms, expressed on this computer's own clock.
    expect(s.frameRuns.p1.startedAt).toBe(NOW - 100_000);
  });

  it("an event stamped in the future (clock disagreement) counts as now", async () => {
    const s = await enter([
      boardEvent(NOW_S - 900, "placeObjectOnStage", prop()),
      boardEvent(NOW_S + 30, "toggleAutoplayFrames", prop({ autoplayFrames: 300 })),
    ]);
    expect(s.frameRuns.p1.startedAt).toBe(NOW);
  });

  it("tolerates archive timestamps in milliseconds", async () => {
    const s = await enter([
      boardEvent((NOW_S - 900) * 1000, "placeObjectOnStage", prop()),
      boardEvent((NOW_S - 100) * 1000, "toggleAutoplayFrames", prop({ autoplayFrames: 300 })),
    ]);
    expect(s.frameRuns.p1.startedAt).toBe(NOW - 100_000);
  });

  it("animated backdrop and curtain are placed in time the same way", async () => {
    const s = await enter([
      backgroundEvent(NOW_S - 130, {
        type: "changeBackground",
        background: {
          id: 5,
          src: FRAMES[0],
          multi: true,
          frames: FRAMES,
          speed: 1,
          dwell: 299,
          at: 1,
        },
      }),
      backgroundEvent(NOW_S - 70, {
        type: "drawCurtain",
        curtain: { id: 6, src: FRAMES[0], multi: true, frames: FRAMES, speed: 2, dwell: 8, at: 2 },
      }),
    ]);
    expect(s.frameRuns[BACKGROUND_RUN]).toMatchObject({
      startedAt: NOW - 130_000,
      fromFrame: FRAMES[0],
    });
    expect(s.frameRuns[CURTAIN_RUN]).toMatchObject({
      startedAt: NOW - 70_000,
      fromFrame: FRAMES[0],
    });
  });

  it("events missed while disconnected are placed in time too", async () => {
    const s = await enter([boardEvent(NOW_S - 500, "placeObjectOnStage", prop())]);
    expect(s.frameRuns.p1).toBeUndefined();
    vi.advanceTimersByTime(60_000);
    loadEvents.mockResolvedValue([
      boardEvent(NOW_S + 15, "toggleAutoplayFrames", prop({ autoplayFrames: 300 })),
    ]);
    await s.reloadMissingEvents();
    // Sent 15 s after entry; noticed 45 s later.
    expect(s.frameRuns.p1.startedAt).toBe(NOW + 15_000);
  });
});

describe("scene changes", () => {
  const scenePayload = () =>
    JSON.stringify({
      background: { id: 5, src: FRAMES[0], multi: true, frames: FRAMES, speed: 1, dwell: 299 },
      board: {
        objects: [prop({ autoplayFrames: 300 }), prop({ id: "still", multi: false })],
        drawings: [],
        texts: [],
        tracks: [],
      },
      curtain: { id: 6, src: FRAMES[0], multi: true, frames: FRAMES, speed: 2, dwell: 8 },
    });

  it("every animation in the scene starts at the moment of the change", () => {
    const s = useStageStore();
    live("placeObjectOnStage", prop({ autoplayFrames: 300 }));
    live("placeObjectOnStage", prop({ id: "gone", autoplayFrames: 300 }));
    const before = s.frameRuns.p1.token;
    vi.advanceTimersByTime(200_000);
    s.REPLACE_SCENE({ payload: scenePayload() });
    expect(s.frameRuns.p1.startedAt).toBe(NOW + 200_000);
    expect(s.frameRuns.p1.token).not.toBe(before);
    expect(s.frameRuns[BACKGROUND_RUN].startedAt).toBe(NOW + 200_000);
    expect(s.frameRuns[CURTAIN_RUN].startedAt).toBe(NOW + 200_000);
    // Objects the scene does not contain take their runs with them.
    expect(s.frameRuns.gone).toBeUndefined();
    expect(s.frameRuns.still).toBeUndefined();
  });

  it("a late joiner places a past scene change at the time it happened", async () => {
    loadStage.mockResolvedValue({
      stage: model([backgroundEvent(NOW_S - 220, { type: "switchScene", scene: 9 })], {
        scenes: [{ id: 9, payload: scenePayload() }],
      }),
    });
    const s = useStageStore();
    await s.loadStage({ url: "demo" });
    expect(s.frameRuns.p1.startedAt).toBe(NOW - 220_000);
    expect(s.frameRuns[BACKGROUND_RUN].startedAt).toBe(NOW - 220_000);
    expect(s.frameRuns[CURTAIN_RUN].startedAt).toBe(NOW - 220_000);
  });
});

describe("backdrop", () => {
  const bg = (extra: Record<string, unknown> = {}) => ({
    id: 5,
    src: FRAMES[0],
    multi: true,
    frames: [...FRAMES],
    speed: 1,
    dwell: 299,
    opacity: 1,
    ...extra,
  });
  let at = 10;
  const set = (extra: Record<string, unknown> = {}) =>
    useStageStore().SET_BACKGROUND(bg({ ...extra, at: (at += 1) }) as never);

  it("dragging the opacity slider does not restart the cycle", () => {
    const s = useStageStore();
    set();
    const run = { ...s.frameRuns[BACKGROUND_RUN] };
    for (let i = 1; i <= 8; i += 1) {
      vi.advanceTimersByTime(100);
      set({ opacity: 1 - i / 10 });
    }
    expect(s.frameRuns[BACKGROUND_RUN]).toEqual(run);
  });

  it("a timing change restarts from the frame the cycle had reached", () => {
    const s = useStageStore();
    set();
    vi.advanceTimersByTime(700_000); // two changes in: on the third frame
    set({ dwell: 9 });
    expect(s.frameRuns[BACKGROUND_RUN]).toMatchObject({
      startedAt: NOW + 700_000,
      fromFrame: FRAMES[2],
    });
    expect(layerCycleMs(s.background!)).toBe(10_000);
  });

  it("a picked frame wins over the reached one", () => {
    const s = useStageStore();
    set();
    vi.advanceTimersByTime(700_000);
    set({ currentFrame: FRAMES[1] });
    expect(s.frameRuns[BACKGROUND_RUN]).toMatchObject({ fromFrame: FRAMES[1] });
  });

  it("another backdrop starts from its own picture, never the old one's frame", () => {
    const s = useStageStore();
    set();
    vi.advanceTimersByTime(400_000);
    set({ id: 6, src: "/resources/x.png", frames: ["/resources/x.png", "/resources/y.png"] });
    expect(s.frameRuns[BACKGROUND_RUN]).toMatchObject({
      startedAt: NOW + 400_000,
      fromFrame: "/resources/x.png",
    });
  });

  it("pausing, a still backdrop or clearing it ends the run", () => {
    const s = useStageStore();
    set();
    set({ speed: 0 });
    expect(s.frameRuns[BACKGROUND_RUN]).toBeUndefined();
    set();
    expect(s.frameRuns[BACKGROUND_RUN]).toBeDefined();
    set({ multi: false, frames: undefined });
    expect(s.frameRuns[BACKGROUND_RUN]).toBeUndefined();
  });

  it("a stale (older) backdrop message changes nothing", () => {
    const s = useStageStore();
    set();
    const run = { ...s.frameRuns[BACKGROUND_RUN] };
    vi.advanceTimersByTime(50_000);
    s.SET_BACKGROUND(bg({ speed: 5, at: 1 }) as never);
    expect(s.frameRuns[BACKGROUND_RUN]).toEqual(run);
  });
});

describe("curtain", () => {
  const curtain = (extra: Record<string, unknown> = {}) => ({
    id: 6,
    src: FRAMES[0],
    multi: true,
    frames: [...FRAMES],
    speed: 2,
    dwell: 8,
    ...extra,
  });

  it("every accepted change restarts the cycle; closing the curtain ends it", () => {
    const s = useStageStore();
    s.drawCurtain(curtain() as never);
    expect(s.frameRuns[CURTAIN_RUN]).toMatchObject({ startedAt: NOW, fromFrame: FRAMES[0] });
    vi.advanceTimersByTime(33_000);
    s.drawCurtain(curtain({ currentFrame: FRAMES[2] }) as never);
    expect(s.frameRuns[CURTAIN_RUN]).toMatchObject({
      startedAt: NOW + 33_000,
      fromFrame: FRAMES[2],
    });
    s.drawCurtain(null);
    expect(s.frameRuns[CURTAIN_RUN]).toBeUndefined();
  });

  it("a paused or single-image curtain has no run", () => {
    const s = useStageStore();
    s.drawCurtain(curtain({ speed: 0 }) as never);
    expect(s.frameRuns[CURTAIN_RUN]).toBeUndefined();
    vi.advanceTimersByTime(10);
    s.drawCurtain("/resources/a.png");
    expect(s.frameRuns[CURTAIN_RUN]).toBeUndefined();
  });

  it("the sender's own echo (same timestamp) does not restart it", () => {
    const s = useStageStore();
    s.drawCurtain(curtain() as never);
    const run = { ...s.frameRuns[CURTAIN_RUN] };
    vi.advanceTimersByTime(4_000);
    s.SET_CURTAIN({ ...s.curtain! });
    expect(s.frameRuns[CURTAIN_RUN]).toEqual(run);
  });
});

describe("replaying a recording", () => {
  const T0 = 1_750_000_000;
  const recording = () =>
    model(
      [
        boardEvent(T0, "placeObjectOnStage", prop()),
        boardEvent(T0 + 100, "toggleAutoplayFrames", prop({ autoplayFrames: 300 })),
        boardEvent(T0 + 900, "moveTo", prop({ autoplayFrames: 300, x: 0.6 })),
      ],
      { status: "live" },
    );

  it("seeking past the start puts the animation that far along", async () => {
    loadStage.mockResolvedValue({ stage: recording() });
    const s = useStageStore();
    await s.loadStage({ url: "demo", recordId: "7" });
    await s.replayRecording(T0 + 500);
    // 400 s of the recording have passed since the speed was set.
    expect(s.frameRuns.p1.startedAt).toBe(NOW - 400_000);
    s.CLEAN_STAGE();
  });

  it("played from the beginning, the run starts when its event comes up", async () => {
    loadStage.mockResolvedValue({ stage: recording() });
    const s = useStageStore();
    await s.loadStage({ url: "demo", recordId: "7" });
    await s.replayRecording(T0);
    expect(s.frameRuns.p1).toBeUndefined();
    vi.advanceTimersByTime(100_000);
    expect(s.frameRuns.p1.startedAt).toBe(NOW + 100_000);
    s.CLEAN_STAGE();
  });
});
