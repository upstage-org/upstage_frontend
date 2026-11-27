// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * #1573: a stage in rehearsal is closed to the audience, and nothing of it
 * may reach them — the store's `stageOpenToViewer` is what the live layout
 * and the Jitsi composable gate on. #1572: the on-stage background colour is
 * a session setting; `loadStage` replays it only for the run of presence
 * that is still going on.
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

const model = (extra: Record<string, unknown>): StageModel =>
  ({
    id: "1",
    fileLocation: "demo",
    assets: [],
    attributes: [{ name: "config", description: JSON.stringify({ defaultcolor: "#30ac45" }) }],
    events: [],
    ...extra,
  }) as unknown as StageModel;

beforeEach(() => {
  setActivePinia(createPinia());
  loadStage.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("stageOpenToViewer", () => {
  it("is false before a stage is loaded", () => {
    expect(useStageStore().stageOpenToViewer).toBe(false);
  });

  it.each([
    ["audience", "rehearsal", false],
    ["audience", "upcoming", false],
    ["audience", undefined, false],
    ["audience", "live", true],
    ["player", "rehearsal", true],
    ["editor", "upcoming", true],
    ["owner", undefined, true],
  ])("permission %s on a %s stage → %s", (permission, status, open) => {
    const s = useStageStore();
    s.SET_MODEL(model({ permission, status }));
    expect(s.stageOpenToViewer).toBe(open);
  });

  it("reads a status that only arrived in the attributes array", () => {
    const s = useStageStore();
    s.SET_MODEL(
      model({
        permission: "audience",
        attributes: [{ name: "status", description: "live" }],
      }),
    );
    expect(s.stageStatus).toBe("live");
    expect(s.stageOpenToViewer).toBe(true);
  });

  it("stays open to a player previewing as audience (masquerade turns canPlay off)", () => {
    const s = useStageStore();
    s.SET_MODEL(model({ permission: "player", status: "rehearsal" }));
    s.TOGGLE_MASQUERADING();
    expect(s.canPlay).toBeFalsy();
    expect(s.stageOpenToViewer).toBe(true);
  });
});

describe("loadStage replays the background colour for the current session only", () => {
  const T0 = 1_700_000_000;
  const counter = (at: number, id: string, extra: Record<string, unknown> = {}) =>
    ({
      id: at,
      topic: `unit/demo/counter`,
      mqttTimestamp: at,
      payload: { id, at: at * 1000, isPlayer: true, ...extra },
    }) as ReplayEvent;
  const colour = (at: number, color: string) =>
    ({
      id: at,
      topic: `unit/demo/background`,
      mqttTimestamp: at,
      payload: { type: "setBackdropColor", color },
    }) as ReplayEvent;

  it("applies a colour set while the stage is still occupied", async () => {
    const s = useStageStore();
    vi.spyOn(Date, "now").mockReturnValue((T0 + 60) * 1000);
    loadStage.mockResolvedValue({
      stage: model({
        permission: "player",
        status: "live",
        events: [counter(T0, "a"), colour(T0 + 10, "#112233")],
      }),
    });
    await s.loadStage({ url: "demo" });
    expect(s.backdropColor).toBe("#112233");
  });

  it("falls back to the saved default once the stage has been empty", async () => {
    const s = useStageStore();
    vi.spyOn(Date, "now").mockReturnValue((T0 + 600) * 1000);
    loadStage.mockResolvedValue({
      stage: model({
        permission: "player",
        status: "live",
        events: [
          counter(T0, "a"),
          colour(T0 + 10, "#112233"),
          counter(T0 + 20, "a", { leaving: true }),
        ],
      }),
    });
    await s.loadStage({ url: "demo" });
    expect(s.backdropColor).toBe("#30ac45");
    // The log itself is untouched: recordings and reconciliation read it all.
    expect(s.model?.events).toHaveLength(3);
  });
});
