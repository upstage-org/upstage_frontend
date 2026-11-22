// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

/**
 * Automatic Jitsi rejoin (2026-11-21 rehearsal on prod).
 *
 * Two players' laptops lost their network for about a minute. The Jitsi
 * server evicted them ("Disconnected: Hibernating too long"), lib-jitsi-meet
 * fired CONNECTION_FAILED, and the stage page only flipped `joined` to false
 * — it never reconnected. The stage kept working over MQTT, so for 30 and 60
 * minutes respectively those browsers showed stream tiles with no media and
 * published streams nobody could receive, until the page was reloaded.
 *
 * These tests drive `useJitsi` against a fake lib-jitsi-meet and pin the
 * recovery contract: any loss of the connection or conference tears the dead
 * pair down and builds a fresh one (with backoff) until the conference is
 * joined again, and events still arriving from the dead room are ignored.
 */

const fake = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  class Emitter {
    listeners = new Map<string, Listener[]>();
    on(ev: string, cb: Listener) {
      this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), cb]);
    }
    emit(ev: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(ev) ?? []) cb(...args);
    }
  }
  let roomSeq = 0;
  class FakeRoom extends Emitter {
    id = `user-${++roomSeq}`;
    joinCalls = 0;
    leaveCalls = 0;
    join() {
      this.joinCalls += 1;
    }
    leave() {
      this.leaveCalls += 1;
      return Promise.resolve();
    }
    myUserId() {
      return this.id;
    }
    getLocalTracks() {
      return [];
    }
  }
  const connections: FakeConnection[] = [];
  class FakeConnection extends Emitter {
    connectCalls = 0;
    disconnectCalls = 0;
    room: FakeRoom | null = null;
    options: unknown;
    constructor(_a: unknown, _b: unknown, options: unknown) {
      super();
      this.options = options;
      connections.push(this);
    }
    addEventListener(ev: string, cb: Listener) {
      this.on(ev, cb);
    }
    connect() {
      this.connectCalls += 1;
    }
    disconnect() {
      this.disconnectCalls += 1;
    }
    initJitsiConference() {
      this.room = new FakeRoom();
      return this.room;
    }
  }
  const names = (prefix: string) =>
    new Proxy({} as Record<string, string>, { get: (_t, key) => `${prefix}.${String(key)}` });
  const JitsiMeetJS = {
    init: vi.fn(),
    setLogLevel: vi.fn(),
    logLevels: names("level"),
    events: { connection: names("connection"), conference: names("conference") },
    JitsiConnection: FakeConnection,
  };
  return { JitsiMeetJS, connections, resetSeq: () => (roomSeq = 0) };
});

const storeMocks = vi.hoisted(() => ({ store: null as unknown as Record<string, any> }));

vi.mock("config", () => ({
  default: {
    JITSI_ENDPOINT: "https://jitsi.test",
    JITSI_ENDPOINTS: ["https://jitsi.test"],
    JITSI_SERVER_COUNT: 1,
  },
}));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    url: "turn",
    canPlay: true,
    jitsiStreamingEnabled: true,
    jitsiServersInUse: [],
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    removeJitsiParticipantLocally: vi.fn(),
    syncLocalJitsiParticipantId: vi.fn(),
    setJitsiConnectionLost: vi.fn(),
    clearRemoteJitsiTracks: vi.fn(),
  });
  storeMocks.store = store;
  return { useStageStore: () => store };
});

import { hardenJitsiLib, useJitsi } from "./composable";

const E = fake.JitsiMeetJS.events;
const store = () => storeMocks.store;
const conn = (i: number) => fake.connections[i];
const mounted: Array<{ unmount: () => void }> = [];

async function mountJitsi() {
  let api!: ReturnType<typeof useJitsi>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useJitsi();
        return () => h("div");
      },
    }),
  );
  mounted.push(wrapper);
  // startSession awaits the server's config.js before it connects.
  await flushPromises();
  // composable.ts is `@ts-nocheck`, so the tuple is inferred as a union array.
  const [jitsi, joined] = api as unknown as [
    { room: unknown; connection: unknown },
    { value: boolean },
  ];
  return { wrapper, jitsi, joined };
}

/** Bring connection `i` all the way to a joined conference. */
async function join(i: number) {
  conn(i).emit(E.connection.CONNECTION_ESTABLISHED, "id");
  const room = conn(i).room!;
  room.emit(E.conference.CONFERENCE_JOINED);
  await flushPromises();
  return room;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fake.connections.length = 0;
  fake.resetSeq();
  (window as unknown as { JitsiMeetJS: unknown }).JitsiMeetJS = fake.JitsiMeetJS;
  // jsdom never loads <script src>, so the config.js probe would hang;
  // report it as failed (the composable then falls back to derived hosts).
  const realAppend = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation((node: Node) => {
    const el = node as HTMLScriptElement;
    if (el.tagName === "SCRIPT") {
      queueMicrotask(() => el.onerror?.(new Event("error")));
      return node;
    }
    return realAppend(node);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useJitsi — automatic rejoin after the connection is lost", () => {
  it("joins once on mount and reports the participant id", async () => {
    const { joined, jitsi } = await mountJitsi();
    expect(fake.connections).toHaveLength(1);
    expect(conn(0).connectCalls).toBe(1);
    const room = await join(0);
    expect(room.joinCalls).toBe(1);
    expect(joined.value).toBe(true);
    expect(jitsi.room).toBe(room);
    expect(store().syncLocalJitsiParticipantId).toHaveBeenLastCalledWith("user-1", undefined);
    expect(store().setJitsiConnectionLost).toHaveBeenLastCalledWith(false);
  });

  it("CONNECTION_FAILED tears the dead pair down and builds a fresh connection + conference", async () => {
    const { joined, jitsi } = await mountJitsi();
    const oldRoom = await join(0);

    conn(0).emit(E.connection.CONNECTION_FAILED, "connection.otherError");
    // lib-jitsi-meet fires it twice in practice; must not double-schedule.
    conn(0).emit(E.connection.CONNECTION_FAILED, "connection.otherError");
    expect(joined.value).toBe(false);
    expect(store().syncLocalJitsiParticipantId).toHaveBeenLastCalledWith(null, undefined);
    expect(store().setJitsiConnectionLost).toHaveBeenLastCalledWith(true);
    expect(fake.connections).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(oldRoom.leaveCalls).toBe(1);
    expect(conn(0).disconnectCalls).toBe(1);
    expect(store().clearRemoteJitsiTracks).toHaveBeenCalledTimes(1);
    expect(fake.connections).toHaveLength(2);
    expect(conn(1).connectCalls).toBe(1);
    // The lib is initialised once per page, not once per attempt.
    expect(fake.JitsiMeetJS.init).toHaveBeenCalledTimes(1);

    const newRoom = await join(1);
    expect(joined.value).toBe(true);
    expect(jitsi.room).toBe(newRoom);
    expect(jitsi.connection).toBe(conn(1));
    expect(store().syncLocalJitsiParticipantId).toHaveBeenLastCalledWith("user-2", undefined);
    expect(store().setJitsiConnectionLost).toHaveBeenLastCalledWith(false);
  });

  it("an unexpected CONNECTION_DISCONNECTED also rejoins", async () => {
    await mountJitsi();
    await join(0);
    conn(0).emit(E.connection.CONNECTION_DISCONNECTED);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.connections).toHaveLength(2);
  });

  it("ignores events that still arrive from the dead room and connection", async () => {
    const { joined } = await mountJitsi();
    const oldRoom = await join(0);
    conn(0).emit(E.connection.CONNECTION_FAILED);
    await vi.advanceTimersByTimeAsync(1000);
    await join(1);
    vi.clearAllMocks();

    // The burst a dead room emits while it is being left must not delete
    // the tiles/tracks the new room is delivering, nor flip `joined`.
    oldRoom.emit(E.conference.USER_LEFT, "someone");
    oldRoom.emit(E.conference.TRACK_REMOVED, { getParticipantId: () => "someone" });
    oldRoom.emit(E.conference.TRACK_ADDED, { getParticipantId: () => "someone" });
    oldRoom.emit(E.conference.CONFERENCE_JOINED);
    oldRoom.emit(E.conference.CONFERENCE_FAILED, "conference.connectionError");
    oldRoom.emit(E.conference.CONNECTION_INTERRUPTED);
    conn(0).emit(E.connection.CONNECTION_FAILED);
    conn(0).emit(E.connection.CONNECTION_DISCONNECTED);
    conn(0).emit(E.connection.CONNECTION_ESTABLISHED);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(store().removeJitsiParticipantLocally).not.toHaveBeenCalled();
    expect(store().removeTrack).not.toHaveBeenCalled();
    expect(store().addTrack).not.toHaveBeenCalled();
    expect(store().syncLocalJitsiParticipantId).not.toHaveBeenCalled();
    expect(store().setJitsiConnectionLost).not.toHaveBeenCalled();
    expect(joined.value).toBe(true);
    expect(fake.connections).toHaveLength(2);
  });

  it("keeps retrying with growing delays while the server stays unreachable, then recovers", async () => {
    const { joined } = await mountJitsi();
    await join(0);
    conn(0).emit(E.connection.CONNECTION_FAILED);
    const delays = [1000, 3000, 5000, 10000, 15000, 15000, 15000];
    for (let i = 0; i < delays.length; i += 1) {
      await vi.advanceTimersByTimeAsync(delays[i] - 1);
      expect(fake.connections).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.connections).toHaveLength(i + 2);
      // This attempt fails too.
      conn(i + 1).emit(E.connection.CONNECTION_FAILED);
    }
    expect(joined.value).toBe(false);
    // Network returns: the next attempt goes through.
    await vi.advanceTimersByTimeAsync(15000);
    await join(fake.connections.length - 1);
    expect(joined.value).toBe(true);
    // Backoff starts over after a successful join.
    conn(fake.connections.length - 1).emit(E.connection.CONNECTION_FAILED);
    const before = fake.connections.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.connections).toHaveLength(before + 1);
  });

  it("an attempt that neither joins nor errors is abandoned after the join timeout", async () => {
    await mountJitsi();
    // Connection never establishes, no error event either.
    await vi.advanceTimersByTimeAsync(44_999);
    expect(fake.connections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1 + 1000);
    expect(fake.connections).toHaveLength(2);
    expect(store().setJitsiConnectionLost).toHaveBeenLastCalledWith(true);
  });

  it("a joined conference is never disturbed by the join timeout", async () => {
    const { joined } = await mountJitsi();
    await join(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fake.connections).toHaveLength(1);
    expect(joined.value).toBe(true);
  });

  it("CONFERENCE_FAILED rejoins, except for errors a new join cannot cure", async () => {
    await mountJitsi();
    const room = await join(0);
    for (const code of [
      "conference.passwordRequired",
      "conference.authenticationRequired",
      "conference.connectionError.accessDenied",
      "conference.connectionError.notAllowed",
      "conference.connectionError.membersOnly",
      "conference.max_users",
      "conference.destroyed",
    ]) {
      room.emit(E.conference.CONFERENCE_FAILED, code);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.connections).toHaveLength(1);
    // Every other failure (focus left, bridge unavailable, ICE failed, a
    // plain connection error) gets a fresh conference.
    room.emit(E.conference.CONFERENCE_FAILED, "conference.connectionError");
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.connections).toHaveLength(2);
  });

  it("media interrupted for 30 s rejoins; a restore in time cancels it", async () => {
    await mountJitsi();
    const room = await join(0);
    room.emit(E.conference.CONNECTION_INTERRUPTED);
    await vi.advanceTimersByTimeAsync(20_000);
    room.emit(E.conference.CONNECTION_RESTORED);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fake.connections).toHaveLength(1);

    room.emit(E.conference.CONNECTION_INTERRUPTED);
    await vi.advanceTimersByTimeAsync(30_000 + 1000);
    expect(fake.connections).toHaveLength(2);
  });

  it("the browser coming back online runs a pending rejoin immediately", async () => {
    await mountJitsi();
    await join(0);
    conn(0).emit(E.connection.CONNECTION_FAILED);
    await vi.advanceTimersByTimeAsync(1000);
    conn(1).emit(E.connection.CONNECTION_FAILED); // next delay is 3 s
    window.dispatchEvent(new Event("online"));
    await flushPromises();
    expect(fake.connections).toHaveLength(3);
    // The superseded timer must not fire a second rejoin.
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.connections).toHaveLength(3);
  });

  it("a disconnect while the tab is unloading does not start a rejoin; a cancelled unload still recovers", async () => {
    await mountJitsi();
    await join(0);
    window.dispatchEvent(new Event("beforeunload"));
    conn(0).emit(E.connection.CONNECTION_DISCONNECTED);
    expect(store().setJitsiConnectionLost).not.toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fake.connections).toHaveLength(1);
    // The page is still here 5 s later (unload was cancelled): recover.
    await vi.advanceTimersByTimeAsync(1 + 1000);
    expect(fake.connections).toHaveLength(2);
  });

  it("unmounting cancels a pending rejoin and never reconnects afterwards", async () => {
    const { wrapper } = await mountJitsi();
    await join(0);
    conn(0).emit(E.connection.CONNECTION_FAILED);
    wrapper.unmount();
    mounted.length = 0;
    await vi.advanceTimersByTimeAsync(120_000);
    conn(0).emit(E.connection.CONNECTION_FAILED);
    conn(0).emit(E.connection.CONNECTION_DISCONNECTED);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fake.connections).toHaveLength(1);
    expect(store().setJitsiConnectionLost).toHaveBeenLastCalledWith(false);
  });
});

/**
 * A stage that is closed to this viewer (#1573: rehearsal, and they are not
 * one of its players) must not join the conference at all — joining delivers
 * the performers' audio to a tab that is still behind the curtain.
 */
describe("useJitsi — stage closed to the viewer (#1573)", () => {
  afterEach(() => {
    delete (store() as Record<string, unknown>).stageOpenToViewer;
  });

  it("does not connect while the stage is closed", async () => {
    store().stageOpenToViewer = false;
    await mountJitsi();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fake.connections).toHaveLength(0);
    expect(store().setJitsiConnectionLost).not.toHaveBeenCalledWith(true);
  });

  it("connects once the stage opens to the viewer (status goes live, or they log in as a player)", async () => {
    store().stageOpenToViewer = false;
    await mountJitsi();
    expect(fake.connections).toHaveLength(0);
    store().stageOpenToViewer = true;
    await flushPromises();
    expect(fake.connections).toHaveLength(1);
    expect(conn(0).connectCalls).toBe(1);
  });

  it("an open stage connects as before", async () => {
    store().stageOpenToViewer = true;
    await mountJitsi();
    expect(fake.connections).toHaveLength(1);
  });
});

/**
 * Uncaught page errors captured on prod (2026-11-23) from inside
 * lib-jitsi-meet's own event handlers; see `hardenJitsiLib`.
 */
describe("hardenJitsiLib — lib-jitsi-meet calls that threw uncaught", () => {
  it("does not send the dominant-speaker stanza while XMPP is disconnected", () => {
    const send = vi.fn((..._args: unknown[]) => {
      throw new Error("Not connected");
    });
    const xmpp = {
      connection: { connected: false },
      sendDominantSpeakerEvent(room: string, silence: boolean) {
        send(room, silence);
      },
    };
    hardenJitsiLib({ xmpp }, {});
    expect(() => xmpp.sendDominantSpeakerEvent("room@muc", false)).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("still sends the dominant-speaker stanza while connected", () => {
    const send = vi.fn();
    const xmpp = {
      connection: { connected: true },
      sendDominantSpeakerEvent(room: string, silence: boolean) {
        send(room, silence);
      },
    };
    hardenJitsiLib({ xmpp }, {});
    xmpp.sendDominantSpeakerEvent("room@muc", true);
    expect(send).toHaveBeenCalledWith("room@muc", true);
  });

  it("swallows the codec-selection crash and passes normal calls through", () => {
    let fail = true;
    const inner = vi.fn((_session: unknown) => {
      if (fail) throw new TypeError("Cannot read properties of undefined (reading 'payloads')");
      return "ok";
    });
    const codec = { selectPreferredCodec: (session: unknown) => inner(session) };
    hardenJitsiLib({}, { qualityController: { codecController: codec } });
    expect(() => codec.selectPreferredCodec("s")).not.toThrow();
    fail = false;
    expect(codec.selectPreferredCodec("s")).toBe("ok");
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("wraps each object once and tolerates a lib without these methods", () => {
    const xmpp = { connection: { connected: true }, sendDominantSpeakerEvent: vi.fn() };
    hardenJitsiLib({ xmpp }, {});
    const first = xmpp.sendDominantSpeakerEvent;
    hardenJitsiLib({ xmpp }, {});
    expect(xmpp.sendDominantSpeakerEvent).toBe(first);
    expect(() => hardenJitsiLib({}, {})).not.toThrow();
    expect(() => hardenJitsiLib(null, null)).not.toThrow();
  });
});
