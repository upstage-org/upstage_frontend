// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * #1566: a prop can be worn by a stream tile as a frame. The store opens the
 * Props panel for a chosen target, places the picked prop over it unpublished,
 * and the existing wearer-follow logic moves the frame with the stream.
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

import { useStageStore } from "./stage";
import { serializeObject } from "@stores/modules/stage/reusable";

beforeEach(() => {
  setActivePinia(createPinia());
  // Board updates arrive viewport-relative (serializeObject) and are scaled
  // back on UPDATE_OBJECT; jsdom's 0×0 viewport would scale everything to 0.
  useStageStore().UPDATE_VIEWPORT({ width: 1000, height: 600 });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const stream = { id: "cam", type: "jitsi", x: 100, y: 50, w: 320, h: 240, rotate: 0 };

describe("add prop to stream", () => {
  it("opens the Props panel for the chosen target and places the picked prop over it, unpublished", () => {
    const s = useStageStore();
    s.board.objects.push(stream as never);
    s.startAttachingProp("cam");
    expect(s.attachingPropTo).toBe("cam");
    expect(s.requestedTool).toBe("Props");
    s.consumeRequestedTool();
    expect(s.requestedTool).toBeNull();

    const frame = s.attachPropTo({ id: 9, name: "Window", type: "prop", src: "/resources/w.png" });
    expect(frame).not.toBeNull();
    expect(frame).toMatchObject({
      x: 100,
      y: 50,
      w: 320,
      h: 240,
      wornBy: "cam",
      liveAction: false,
    });
    expect(frame!.id).not.toBe(9);
    expect(s.attachingPropTo).toBeNull();
    expect(s.board.objects.map((o) => o.id)).toEqual(["cam", frame!.id]);
  });

  it("follows the stream when it moves or resizes", () => {
    const s = useStageStore();
    s.board.objects.push({ ...stream } as never);
    s.startAttachingProp("cam");
    const frame = s.attachPropTo({ id: 9, name: "Window", type: "prop" })!;

    s.UPDATE_OBJECT(serializeObject({ ...stream, x: 400, y: 150 } as never));
    const moved = s.board.objects.find((o) => o.id === frame.id)!;
    expect(moved.x).toBe(400);
    expect(moved.y).toBe(150);

    s.UPDATE_OBJECT(serializeObject({ ...stream, x: 400, y: 150, w: 640, h: 480 } as never));
    const resized = s.board.objects.find((o) => o.id === frame.id)!;
    expect(resized.w).toBe(640);
    expect(resized.h).toBe(480);
  });

  it("does nothing when cancelled or when the target has left the stage", () => {
    const s = useStageStore();
    s.startAttachingProp("cam");
    s.cancelAttachingProp();
    expect(s.attachPropTo({ id: 9, type: "prop" })).toBeNull();
    s.startAttachingProp("gone");
    expect(s.attachPropTo({ id: 9, type: "prop" })).toBeNull();
    expect(s.board.objects).toEqual([]);
    expect(s.attachingPropTo).toBeNull();
  });
});

describe("removing the wearer removes its props (#1566 follow-up)", () => {
  const lit = (s: ReturnType<typeof useStageStore>, wearer: Record<string, unknown>) => {
    s.board.objects.push({ ...wearer } as never);
    s.startAttachingProp(wearer.id as string);
    const frame = s.attachPropTo({ id: 9, name: "Window", type: "prop" })!;
    return frame;
  };

  it("deleting a stream takes the attached frame off the stage with it", () => {
    const s = useStageStore();
    const frame = lit(s, stream);
    s.board.objects.push({ id: "other", type: "prop", x: 0, y: 0, w: 10, h: 10 } as never);
    s.deleteObject(s.board.objects.find((o) => o.id === "cam")!);
    expect(s.board.objects.map((o) => o.id)).toEqual(["other"]);
    expect(s.board.objects.some((o) => o.id === frame.id)).toBe(false);
  });

  it("deleting an avatar takes its costume with it", () => {
    const s = useStageStore();
    s.board.objects.push({ id: "ava", type: "avatar", x: 0, y: 0, w: 50, h: 50 } as never);
    s.board.objects.push({
      id: "hat",
      type: "prop",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      wornBy: "ava",
    } as never);
    s.deleteObject(s.board.objects.find((o) => o.id === "ava")!);
    expect(s.board.objects).toEqual([]);
  });

  it("a prop taken off first stays on the stage", () => {
    const s = useStageStore();
    const frame = lit(s, stream);
    s.board.objects.find((o) => o.id === frame.id)!.wornBy = null;
    s.deleteObject(s.board.objects.find((o) => o.id === "cam")!);
    expect(s.board.objects.map((o) => o.id)).toEqual([frame.id]);
  });

  it("a remote DESTROY of the wearer alone only detaches (the sender removes its props itself)", () => {
    const s = useStageStore();
    const frame = lit(s, stream);
    s.DELETE_OBJECT(serializeObject({ ...stream } as never));
    const left = s.board.objects.find((o) => o.id === frame.id)!;
    expect(left.wornBy).toBeNull();
  });

  it("a stream tile that is only away (its performer reloads) keeps its frame attached", () => {
    const s = useStageStore();
    const frame = lit(s, { ...stream, participantId: "abcd1234" });
    s.removeJitsiParticipantLocally("abcd1234");
    expect(s.board.objects.map((o) => o.id)).toEqual([frame.id]);
    expect(s.board.objects[0].wornBy).toBe("cam");
  });
});

describe("add prop to meeting (#1566 follow-up)", () => {
  const meeting = { id: "room", type: "meeting", x: 10, y: 20, w: 600, h: 400, rotate: 0 };

  it("places the picked prop over the meeting, worn by it, and it follows the meeting", () => {
    const s = useStageStore();
    s.board.objects.push({ ...meeting } as never);
    s.startAttachingProp("room");
    const cover = s.attachPropTo({ id: 9, name: "Bar", type: "prop" })!;
    expect(cover).toMatchObject({ x: 10, y: 20, w: 600, h: 400, wornBy: "room" });
    s.UPDATE_OBJECT(serializeObject({ ...meeting, x: 200, y: 100 } as never));
    expect(s.board.objects.find((o) => o.id === cover.id)).toMatchObject({ x: 200, y: 100 });
    s.deleteObject(s.board.objects.find((o) => o.id === "room")!);
    expect(s.board.objects).toEqual([]);
  });
});
