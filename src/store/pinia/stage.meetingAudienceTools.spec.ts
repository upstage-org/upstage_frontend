// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

/**
 * Audience tools of an embedded meeting (#1580), as the stage store carries
 * them. The setting is one more field on the meeting's board object; no
 * store code was added for it. These tests pin what that relies on:
 *
 *  - a player's choice is published with the meeting and reaches every
 *    viewer's copy of the object, including someone who arrives later;
 *  - switching it off again really overwrites the open level;
 *  - an audience session cannot publish it (the store's publish gate);
 *  - it is a property of that one meeting: other meetings, and the
 *    individual stream tiles and their tracks, are untouched by it.
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

import { useStageStore, type StageModel } from "./stage";
import { normalizeAudienceTools } from "@components/objects/MeetingObject/audienceTools";

type Wire = { type: string; object: Record<string, unknown> };
const published = () =>
  sendMessage.mock.calls
    .filter((call) => (call as unknown[])[0] === "board")
    .map((call) => (call as unknown[])[1] as Wire);

const model = (permission: string): StageModel =>
  ({
    id: "1",
    fileLocation: "demo",
    assets: [],
    attributes: [],
    permission,
    status: "live",
    events: [],
  }) as unknown as StageModel;

/** A store as one browser has it, with a meeting already on stage and published. */
function seat(permission: "owner" | "audience") {
  setActivePinia(createPinia());
  const s = useStageStore();
  s.UPDATE_VIEWPORT({ width: 1000, height: 600 });
  s.SET_MODEL(model(permission));
  return s;
}
const MEETING = {
  id: "meet-1",
  type: "meeting",
  name: "Workshop",
  x: 0.2,
  y: 0.2,
  w: 0.3,
  h: 0.3,
  rotate: 0,
  opacity: 1,
};
const place = (s: ReturnType<typeof useStageStore>, object: Record<string, unknown>) =>
  s.handleBoardMessage({
    message: { type: "placeObjectOnStage", object: { ...object } } as never,
  });
const meetingOf = (s: ReturnType<typeof useStageStore>, id = "meet-1") =>
  s.board.objects.find((o) => o.id === id) as Record<string, unknown>;

beforeEach(() => {
  sendMessage.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("a player's choice travels with the meeting", () => {
  it("is published with the object and applied on every viewer's copy", () => {
    const player = seat("owner");
    place(player, MEETING);
    expect(normalizeAudienceTools(meetingOf(player).audienceTools)).toBe("none");

    player.shapeObject({ ...meetingOf(player), audienceTools: "mic" } as never);
    expect(meetingOf(player).audienceTools).toBe("mic");
    const sent = published();
    expect(sent).toHaveLength(1);
    expect(sent[0].object).toMatchObject({ id: "meet-1", type: "meeting", audienceTools: "mic" });

    // The audience's browser receives that very message.
    const viewer = seat("audience");
    place(viewer, MEETING);
    viewer.handleBoardMessage({ message: structuredClone(sent[0]) as never });
    expect(meetingOf(viewer).audienceTools).toBe("mic");
  });

  it("switching off overwrites the open level everywhere", () => {
    const player = seat("owner");
    place(player, { ...MEETING, audienceTools: "mic-camera" });
    player.shapeObject({ ...meetingOf(player), audienceTools: "none" } as never);
    const sent = published();
    expect(sent[0].object.audienceTools).toBe("none");

    const viewer = seat("audience");
    place(viewer, { ...MEETING, audienceTools: "mic-camera" });
    viewer.handleBoardMessage({ message: structuredClone(sent[0]) as never });
    expect(normalizeAudienceTools(meetingOf(viewer).audienceTools)).toBe("none");
  });

  it("someone arriving later gets the level with the meeting itself", () => {
    const late = seat("audience");
    place(late, { ...MEETING, audienceTools: "mic" });
    expect(meetingOf(late).audienceTools).toBe("mic");
  });

  it("a later move or resize by a player keeps the level (the whole object is sent)", () => {
    const player = seat("owner");
    place(player, { ...MEETING, audienceTools: "mic" });
    const live = meetingOf(player);
    player.shapeObject({ ...live, x: (live.x as number) + 50 } as never);
    expect(published()[0].object.audienceTools).toBe("mic");
    expect(meetingOf(player).audienceTools).toBe("mic");
  });

  it("an unpublished meeting keeps the choice locally and sends it when it goes live", () => {
    const player = seat("owner");
    const placed = player.placeObjectOnStage({ type: "meeting", name: "Later", w: 320, h: 240 });
    player.shapeObject({
      ...meetingOf(player, placed.id as string),
      audienceTools: "mic",
    } as never);
    expect(published()).toHaveLength(0); // lightbulb off: nothing leaves this browser
    expect(meetingOf(player, placed.id as string).audienceTools).toBe("mic");

    player.shapeObject({
      ...meetingOf(player, placed.id as string),
      liveAction: true,
      published: false,
    } as never);
    const sent = published();
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("placeObjectOnStage");
    expect(sent[0].object.audienceTools).toBe("mic");
  });
});

describe("only players can send it", () => {
  it("an audience session's attempt is refused by the publish gate", () => {
    const viewer = seat("audience");
    place(viewer, MEETING);
    expect(viewer.canPlay).toBeFalsy();
    viewer.shapeObject({ ...meetingOf(viewer), audienceTools: "mic-camera" } as never);
    expect(published()).toHaveLength(0);
  });
});

describe("it belongs to that one meeting and nothing else", () => {
  it("other meetings, stream tiles, their tracks and the server list are untouched", () => {
    const player = seat("owner");
    place(player, MEETING);
    place(player, { ...MEETING, id: "meet-2", name: "Second room" });
    place(player, {
      id: "cam-1",
      type: "jitsi",
      participantId: "p-1",
      hostId: "someone-else",
      x: 0.5,
      y: 0.5,
      w: 0.2,
      h: 0.2,
      rotate: 0,
    });
    const snapshot = () =>
      JSON.stringify({
        second: meetingOf(player, "meet-2"),
        tile: meetingOf(player, "cam-1"),
        tracks: player.board.tracks.length,
        jitsiTracks: player.jitsiTracks.length,
        servers: [...player.jitsiServersInUse],
      });
    const before = snapshot();

    for (const level of ["mic", "mic-camera", "none", "mic"]) {
      player.shapeObject({ ...meetingOf(player), audienceTools: level } as never);
    }
    expect(snapshot()).toBe(before);
    expect(meetingOf(player, "cam-1").audienceTools).toBeUndefined();
    expect(meetingOf(player, "meet-2").audienceTools).toBeUndefined();
    // Every message was about the meeting, as a move/shape update.
    for (const message of published()) {
      expect(message.object.id).toBe("meet-1");
      expect(message.type).toBe("moveTo");
    }
  });

  it("the field means nothing on a stream tile: it is just carried along, unread", () => {
    const player = seat("owner");
    place(player, {
      id: "cam-1",
      type: "jitsi",
      participantId: "p-1",
      hostId: "someone-else",
      audienceTools: "mic-camera",
      x: 0.5,
      y: 0.5,
      w: 0.2,
      h: 0.2,
      rotate: 0,
    });
    expect(meetingOf(player, "cam-1").type).toBe("jitsi");
    expect(player.board.objects.filter((o) => o.type === "jitsi")).toHaveLength(1);
  });
});
