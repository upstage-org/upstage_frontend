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
