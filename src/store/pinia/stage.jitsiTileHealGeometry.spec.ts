// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Every (re)join of the Jitsi conference hands this tab a new participant
 * id, and the store then rewrites its own stream tiles with it and tells the
 * other clients (syncLocalJitsiParticipantId, and the post-publish safety
 * net ensureJitsiTileParticipantBroadcast).
 *
 * Both used to pass a copy of the STORE object (pixels) to UPDATE_OBJECT,
 * which takes a WIRE object (stage-relative) and converts it in place. The
 * tile's x/y/w/h were multiplied by the stage width locally, and the pixel
 * values then went out on the wire, so every client multiplied them again.
 * A performer who reloaded the page — or whose connection was re-established
 * — had her stream tile thrown far off the stage for everybody, and further
 * with every reload (seen in the 2026-11-21 rehearsal archive: x = 744, then
 * 1 180 789, then 1 874 567 412 …).
 */

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn(() => Promise.resolve()) }));
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

import { useStageStore } from "./stage";
import { BOARD_ACTIONS } from "@utils/constants";

type StageStore = ReturnType<typeof useStageStore>;
type Wire = { type: string; object: Record<string, number | string> };

const GEOMETRY = { x: 450, y: 260, w: 240, h: 180 };
let store: StageStore;
let width: number;

const ownTile = (extra: Record<string, unknown> = {}) => ({
  id: "tile-1",
  name: "cam",
  type: "jitsi",
  participantId: "p-old",
  hostId: "tab-me",
  ...GEOMETRY,
  opacity: 1,
  rotate: 0,
  liveAction: true,
  published: true,
  ...extra,
});
const stored = (id = "tile-1") => {
  const o = store.board.objects.find((o) => o.id === id)!;
  return { x: o.x, y: o.y, w: o.w, h: o.h };
};
const boardMessages = () =>
  sendMessage.mock.calls.map((c) => (c as unknown as [string, Wire])[1]).filter((m) => m?.object);
const expectGeometry = (actual: Record<string, unknown>, wanted: typeof GEOMETRY) => {
  for (const k of ["x", "y", "w", "h"] as const) {
    expect(actual[k] as number).toBeCloseTo(wanted[k], 6);
  }
};

beforeEach(() => {
  setActivePinia(createPinia());
  sendMessage.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  store = useStageStore();
  store.UPDATE_VIEWPORT({ width: 1400, height: 900 });
  width = store.stageSize.width;
  expect(width).toBeGreaterThan(100);
  store.session = "tab-me";
  store.model = { permission: "owner" } as never;
  expect(store.canPlay).toBe(true);
});

describe("own stream tile keeps its place when the participant id changes", () => {
  it("rejoin / reload (syncLocalJitsiParticipantId): the store keeps the tile's geometry", () => {
    store.board.objects.push(ownTile() as never);
    store.syncLocalJitsiParticipantId("p-new");
    expectGeometry(stored(), GEOMETRY);
    expect(store.board.objects[0].participantId).toBe("p-new");
  });

  it("…and what goes out to the other clients is stage-relative, not pixels", () => {
    store.board.objects.push(ownTile() as never);
    store.syncLocalJitsiParticipantId("p-new");
    const sent = boardMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe(BOARD_ACTIONS.MOVE_TO);
    expect(sent[0].object.participantId).toBe("p-new");
    expectGeometry(sent[0].object, {
      x: GEOMETRY.x / width,
      y: GEOMETRY.y / width,
      w: GEOMETRY.w / width,
      h: GEOMETRY.h / width,
    });
  });

  it("a receiver applying that message puts the tile exactly where it was", () => {
    store.board.objects.push(ownTile() as never);
    store.syncLocalJitsiParticipantId("p-new");
    const wire = boardMessages()[0];
    // the same message as another client (or this one, as an echo) gets it
    store.session = "tab-audience";
    store.handleBoardMessage({
      message: { ...JSON.parse(JSON.stringify(wire)), sender: "tab-me", seq: 99 } as never,
    });
    expectGeometry(stored(), GEOMETRY);
  });

  it("does not drift over many rejoins", () => {
    store.board.objects.push(ownTile() as never);
    for (let i = 0; i < 25; i++) store.syncLocalJitsiParticipantId(`p-${i}`);
    expectGeometry(stored(), GEOMETRY);
    const last = boardMessages().at(-1)!;
    expect(last.object.x as number).toBeCloseTo(GEOMETRY.x / width, 6);
    expect(last.object.w as number).toBeCloseTo(GEOMETRY.w / width, 6);
  });

  it("a prop worn by the tile stays on it", () => {
    store.board.objects.push(ownTile() as never);
    store.board.objects.push({
      id: "frame",
      type: "prop",
      wornBy: "tile-1",
      ...GEOMETRY,
      opacity: 1,
      rotate: 0,
    } as never);
    store.syncLocalJitsiParticipantId("p-new");
    expectGeometry(stored("frame"), GEOMETRY);
  });

  it("post-publish safety net (ensureJitsiTileParticipantBroadcast): same guarantees", () => {
    store.board.objects.push(ownTile() as never);
    store.ensureJitsiTileParticipantBroadcast("p-new");
    expectGeometry(stored(), GEOMETRY);
    const sent = boardMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].object.participantId).toBe("p-new");
    expectGeometry(sent[0].object, {
      x: GEOMETRY.x / width,
      y: GEOMETRY.y / width,
      w: GEOMETRY.w / width,
      h: GEOMETRY.h / width,
    });
  });

  it("a tile that never had a participant id is healed without moving either", () => {
    store.board.objects.push(
      ownTile({ participantId: null, published: false, liveAction: false }) as never,
    );
    store.syncLocalJitsiParticipantId("p-new");
    expectGeometry(stored(), GEOMETRY);
    expect(boardMessages()).toHaveLength(0);
  });
});
