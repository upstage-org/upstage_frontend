// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Scenes and the curtain (#1578).
 *
 * Scene snapshots did not record the curtain, so it stayed whatever it was
 * across a scene switch: after saving a second scene with the curtain down,
 * the first scene (saved without one) also came back curtained, and the
 * other way round. A scene now carries its own curtain state.
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

import { useStageStore } from "./stage";
import { takeSnapshotFromStage } from "../modules/stage/reusable";

type StageStore = ReturnType<typeof useStageStore>;
let store: StageStore;
const curtainSrc = () => (store.curtain as { src?: string } | null)?.src ?? null;

// drawCurtain stamps each curtain with the current time and ignores a change
// that is not strictly newer, so two draws must not share a millisecond.
let clock = Date.parse("2026-11-23T00:00:00Z");
const draw = (c: Parameters<StageStore["drawCurtain"]>[0]) => {
  clock += 1000;
  vi.setSystemTime(clock);
  store.drawCurtain(c);
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(clock);
  setActivePinia(createPinia());
  store = useStageStore();
  store.UPDATE_VIEWPORT({ width: 1000, height: 600 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("scene snapshot records the curtain", () => {
  it("saves the drawn curtain with the scene", () => {
    draw({ src: "/c/red.png" });
    const snapshot = JSON.parse(takeSnapshotFromStage());
    expect(snapshot.curtain).toMatchObject({ src: "/c/red.png" });
  });

  it("saves an explicit null when no curtain is drawn", () => {
    const snapshot = JSON.parse(takeSnapshotFromStage());
    expect(Object.prototype.hasOwnProperty.call(snapshot, "curtain")).toBe(true);
    expect(snapshot.curtain).toBeNull();
  });
});

describe("loading a scene applies that scene's curtain", () => {
  it("the reported case: scene 1 without curtain, scene 2 with curtain", () => {
    const scene1 = takeSnapshotFromStage(); // no curtain
    draw({ src: "/c/red.png" });
    const scene2 = takeSnapshotFromStage(); // curtain down

    store.REPLACE_SCENE({ payload: scene1 });
    expect(store.curtain).toBeNull();

    store.REPLACE_SCENE({ payload: scene2 });
    expect(curtainSrc()).toBe("/c/red.png");

    store.REPLACE_SCENE({ payload: scene1 });
    expect(store.curtain).toBeNull();
  });

  it("the converse: scene 1 with curtain, scene 2 without", () => {
    draw({ src: "/c/red.png" });
    const scene1 = takeSnapshotFromStage();
    draw(null);
    const scene2 = takeSnapshotFromStage();

    store.REPLACE_SCENE({ payload: scene2 });
    expect(store.curtain).toBeNull();
    store.REPLACE_SCENE({ payload: scene1 });
    expect(curtainSrc()).toBe("/c/red.png");
  });

  it("switches between two different curtains", () => {
    draw({ src: "/c/red.png" });
    const red = takeSnapshotFromStage();
    draw({ src: "/c/blue.png" });
    const blue = takeSnapshotFromStage();
    store.REPLACE_SCENE({ payload: red });
    expect(curtainSrc()).toBe("/c/red.png");
    store.REPLACE_SCENE({ payload: blue });
    expect(curtainSrc()).toBe("/c/blue.png");
  });

  it("keeps the curtain's own settings (frames, speed, loop)", () => {
    draw({ src: "/c/a.png", multi: true, frames: ["/c/a.png", "/c/b.png"], speed: 0.5 });
    const scene = takeSnapshotFromStage();
    draw(null);
    store.REPLACE_SCENE({ payload: scene });
    expect(store.curtain).toMatchObject({
      src: "/c/a.png",
      multi: true,
      frames: ["/c/a.png", "/c/b.png"],
      speed: 0.5,
    });
  });

  it("a curtain drawn or lifted AFTER loading a scene still takes effect", () => {
    draw({ src: "/c/red.png" });
    const withCurtain = takeSnapshotFromStage();
    draw(null);
    store.REPLACE_SCENE({ payload: withCurtain });
    expect(curtainSrc()).toBe("/c/red.png");

    // a broadcast older than "now" but newer than when the scene was saved
    store.SET_CURTAIN({ src: "/c/blue.png", at: Date.now() - 1 });
    expect(curtainSrc()).toBe("/c/blue.png");
    store.SET_CURTAIN(null);
    expect(store.curtain).toBeNull();
  });

  it("a scene saved before this change (no curtain recorded) leaves the curtain as it is", () => {
    const legacy = JSON.stringify({
      background: null,
      backdropColor: "#000",
      board: { objects: [], drawings: [], texts: [], tracks: [] },
    });
    draw({ src: "/c/red.png" });
    store.REPLACE_SCENE({ payload: legacy });
    expect(curtainSrc()).toBe("/c/red.png");

    draw(null);
    store.REPLACE_SCENE({ payload: legacy });
    expect(store.curtain).toBeNull();
  });

  it("the blank scene leaves the curtain as it is", () => {
    draw({ src: "/c/red.png" });
    store.handleBackgroundMessage({ message: { type: "blankScene" } } as never);
    expect(curtainSrc()).toBe("/c/red.png");
  });
});
