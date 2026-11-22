// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Saved text objects and object drawings survive a scene change (#648).
 *
 * The Text and Draw tools list what the player has created during the visit
 * (`board.texts` / `board.drawings`). Switching scene replaced the whole
 * board with the scene's, so those lists were replaced too and the player's
 * saved texts/drawings vanished from the toolbar. They must stay available
 * until the player leaves the stage.
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

const text = (textId: string, content = textId) =>
  ({ textId, content, w: 100, h: 40, x: 10, y: 10 }) as never;
const drawing = (drawingId: string) =>
  ({ drawingId, commands: [], w: 100, h: 100, x: 10, y: 10 }) as never;
const textIds = () => store.board.texts.map((t) => t.textId);
const drawingIds = () => store.board.drawings.map((d) => d.drawingId);
const scene = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    background: null,
    backdropColor: "#000000",
    board: { objects: [], drawings: [], texts: [], tracks: [], ...extra },
  });

beforeEach(() => {
  setActivePinia(createPinia());
  store = useStageStore();
  store.UPDATE_VIEWPORT({ width: 1000, height: 600 });
});

describe("saved text objects and drawings across scene changes", () => {
  it("keeps the player's saved texts and drawings when switching to another scene", () => {
    store.PUSH_TEXT(text("t1"));
    store.PUSH_DRAWING(drawing("d1"));
    store.REPLACE_SCENE({ payload: scene() });
    expect(textIds()).toEqual(["t1"]);
    expect(drawingIds()).toEqual(["d1"]);
  });

  it("keeps them across the blank scene", () => {
    store.PUSH_TEXT(text("t1"));
    store.PUSH_DRAWING(drawing("d1"));
    store.handleBackgroundMessage({ message: { type: "blankScene" } } as never);
    expect(textIds()).toEqual(["t1"]);
    expect(drawingIds()).toEqual(["d1"]);
    expect(store.board.objects).toHaveLength(0);
  });

  it("keeps them across several scene changes in a row", () => {
    store.PUSH_TEXT(text("t1"));
    store.REPLACE_SCENE({ payload: scene() });
    store.PUSH_TEXT(text("t2"));
    store.PUSH_DRAWING(drawing("d1"));
    store.REPLACE_SCENE({ payload: scene() });
    store.REPLACE_SCENE({ payload: scene() });
    expect(textIds()).toEqual(["t1", "t2"]);
    expect(drawingIds()).toEqual(["d1"]);
  });

  it("adds the texts and drawings a scene brings, without duplicating ones already there", () => {
    store.PUSH_TEXT(text("t1"));
    store.PUSH_DRAWING(drawing("d1"));
    store.REPLACE_SCENE({
      payload: scene({
        texts: [text("t1", "scene copy"), text("t9")],
        drawings: [drawing("d1"), drawing("d9")],
      }),
    });
    expect(textIds()).toEqual(["t1", "t9"]);
    expect(drawingIds()).toEqual(["d1", "d9"]);
    // the player's own copy wins over the scene's
    expect((store.board.texts[0] as { content?: string }).content).toBe("t1");
  });

  it("round-trips through a real scene snapshot", () => {
    store.PUSH_TEXT(text("t1"));
    const saved = takeSnapshotFromStage();
    store.PUSH_TEXT(text("t2"));
    store.PUSH_DRAWING(drawing("d1"));
    store.REPLACE_SCENE({ payload: saved });
    expect(textIds()).toEqual(["t1", "t2"]);
    expect(drawingIds()).toEqual(["d1"]);
  });

  it("still replaces what is ON the stage with the scene's objects", () => {
    store.PUSH_TEXT(text("t1"));
    store.board.objects.push({
      id: "o1",
      type: "text",
      textId: "t1",
      x: 1,
      y: 1,
      w: 1,
      h: 1,
      rotate: 0,
    } as never);
    store.REPLACE_SCENE({ payload: scene() });
    expect(store.board.objects).toHaveLength(0);
    expect(textIds()).toEqual(["t1"]);
  });

  it("a text the player deleted from the toolbar stays deleted on a scene without it", () => {
    store.PUSH_TEXT(text("t1"));
    store.PUSH_TEXT(text("t2"));
    store.POP_TEXT("t1");
    store.REPLACE_SCENE({ payload: scene() });
    expect(textIds()).toEqual(["t2"]);
  });

  it("leaving the stage still clears them", () => {
    store.PUSH_TEXT(text("t1"));
    store.PUSH_DRAWING(drawing("d1"));
    store.CLEAN_STAGE();
    expect(textIds()).toEqual([]);
    expect(drawingIds()).toEqual([]);
  });
});
