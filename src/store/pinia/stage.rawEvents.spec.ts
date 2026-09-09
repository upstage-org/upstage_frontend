// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { isReactive } from "vue";

/**
 * The archived event log (`model.events`) must stay OUT of Vue's reactivity
 * graph. Pinia's `$subscribe` (installed by pinia-plugin-persistedstate
 * because the store declares `persist`) is a `deep: true` watch over the
 * whole store state, so a reactive event log — thousands of rows on a
 * busy stage — was re-traversed on every store mutation (each audio
 * `timeupdate`, each drag move …), stalling the main thread for hundreds
 * of milliseconds at a time. Readers only ever treat it as a plain array
 * and the one append path reassigns the property, which stays reactive.
 */

const { sendMessage, loadEvents } = vi.hoisted(() => ({
  sendMessage: vi.fn(() => Promise.resolve()),
  loadEvents: vi.fn(),
}));
vi.mock("@services/mqtt", () => ({
  default: () => ({
    connect: vi.fn(),
    whenConnected: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => Promise.resolve()),
    sendMessage,
    sendMessageSync: vi.fn(),
    receiveMessage: vi.fn(),
  }),
}));
vi.mock("@services/speech", () => ({ avatarSpeak: vi.fn(), stopSpeaking: vi.fn() }));
vi.mock("@services/graphql", () => ({
  stageGraph: { loadEvents },
  studioClient: {},
}));

import { useStageStore, type ReplayEvent, type StageModel } from "./stage";

const event = (id: number): ReplayEvent =>
  ({
    id,
    topic: "unit/test/unknown-topic",
    mqttTimestamp: 1000 + id,
    payload: { nested: { deep: { value: id } } },
  }) as unknown as ReplayEvent;

const model = (events: ReplayEvent[]): StageModel =>
  ({
    id: "1",
    fileLocation: "demo",
    assets: [],
    attributes: [],
    events,
  }) as unknown as StageModel;

beforeEach(() => {
  setActivePinia(createPinia());
  loadEvents.mockReset();
});

describe("model.events stays raw", () => {
  it("SET_MODEL marks the event log non-reactive while the model itself stays reactive", () => {
    const s = useStageStore();
    s.SET_MODEL(model([event(1), event(2)]));
    expect(isReactive(s.model)).toBe(true);
    expect(isReactive(s.model!.events)).toBe(false);
    expect(isReactive(s.model!.events![0])).toBe(false);
    expect(s.model!.events).toHaveLength(2);
    expect(s.model!.events![1].id).toBe(2);
  });

  it("a model without events is unaffected", () => {
    const s = useStageStore();
    s.SET_MODEL(model(undefined as unknown as ReplayEvent[]));
    expect(s.model!.events).toBeUndefined();
    s.SET_MODEL(null);
    expect(s.model).toBeNull();
  });

  it("reloadMissingEvents appends by reassignment and keeps the log raw", async () => {
    const s = useStageStore();
    s.SET_MODEL(model([event(1)]));
    loadEvents.mockResolvedValue([event(2), event(3)]);

    await s.reloadMissingEvents();

    expect(loadEvents).toHaveBeenCalledWith("demo", 1);
    expect(s.model!.events!.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(isReactive(s.model!.events)).toBe(false);
  });

  it("reassigning the log is still observable at the model level", async () => {
    const s = useStageStore();
    s.SET_MODEL(model([event(1)]));
    loadEvents.mockResolvedValue([event(2)]);
    // Same dependency shape as views/replay/EventIndicator.vue's computed.
    const seen: number[] = [];
    const { watch } = await import("vue");
    watch(
      () => s.model?.events?.length ?? 0,
      (n) => seen.push(n),
      { flush: "sync" },
    );

    await s.reloadMissingEvents();

    expect(seen).toEqual([2]);
  });
});
