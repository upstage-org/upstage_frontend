// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";

/**
 * useJitsi's `startSession` awaits the server's config.js before it creates
 * the XMPP connection. If the stage component unmounts during that fetch,
 * the connection used to be created (and `connect()`ed) afterwards with
 * nobody left to disconnect it — a leaked WebSocket per navigation. The
 * guard must skip the connect in that case and change nothing otherwise.
 */

const cfg = vi.hoisted(() => ({
  JITSI_ENDPOINT: "https://meet-a.test",
  JITSI_ENDPOINTS: ["https://meet-a.test"],
  JITSI_SERVER_COUNT: 1,
}));
vi.mock("config", () => ({ default: cfg }));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    url: "stage-1",
    canPlay: false,
    jitsiStreamingEnabled: false,
    jitsiServersInUse: [] as string[],
    syncLocalJitsiParticipantId: vi.fn(),
  });
  return { useStageStore: () => store };
});

import { useJitsi } from "./composable";

const connections: Array<{
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}> = [];

class FakeJitsiConnection {
  connect = vi.fn();
  disconnect = vi.fn();
  addEventListener = vi.fn();
  constructor() {
    connections.push(this);
  }
}

function installJitsiStub() {
  (window as unknown as { JitsiMeetJS: unknown }).JitsiMeetJS = {
    init: vi.fn(),
    setLogLevel: vi.fn(),
    logLevels: { WARN: "warn" },
    events: {
      connection: {
        CONNECTION_ESTABLISHED: "ce",
        CONNECTION_FAILED: "cf",
        CONNECTION_DISCONNECTED: "cd",
      },
      conference: {},
    },
    JitsiConnection: FakeJitsiConnection,
  };
}

function mountJitsi() {
  const Comp = defineComponent({
    setup() {
      useJitsi();
      return () => h("div");
    },
  });
  return mount(Comp);
}

/** The pending config.js <script> for `host`, appended by loadJitsiServerConfig. */
function pendingConfigScript(host: string) {
  return document.head.querySelector<HTMLScriptElement>(`script[src="https://${host}/config.js"]`);
}

beforeEach(() => {
  installJitsiStub();
  connections.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = "";
});

describe("useJitsi — unmount while config.js is still loading", () => {
  it("does not create or connect an XMPP connection after unmount", async () => {
    cfg.JITSI_ENDPOINT = "https://meet-a.test";
    cfg.JITSI_ENDPOINTS = ["https://meet-a.test"];
    const wrapper = mountJitsi();
    await flushPromises();
    const script = pendingConfigScript("meet-a.test");
    expect(script).not.toBeNull();
    expect(connections).toHaveLength(0);

    // Leave the stage before the server answered.
    wrapper.unmount();
    script?.onerror?.(new Event("error"));
    await flushPromises();

    expect(connections).toHaveLength(0);
  });

  it("still connects, and disconnects on unmount, when the config arrives while mounted", async () => {
    cfg.JITSI_ENDPOINT = "https://meet-b.test";
    cfg.JITSI_ENDPOINTS = ["https://meet-b.test"];
    const wrapper = mountJitsi();
    await flushPromises();
    const script = pendingConfigScript("meet-b.test");
    expect(script).not.toBeNull();

    script?.onerror?.(new Event("error"));
    await flushPromises();
    expect(connections).toHaveLength(1);
    expect(connections[0].connect).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    expect(connections[0].disconnect).toHaveBeenCalledTimes(1);
  });
});
