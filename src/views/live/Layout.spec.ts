// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * #1573: the audience could hear a rehearsal. The curtain (Preloader) kept
 * them out visually, but the layout mounted the board — with every stream
 * tile — and the audio player behind it, and joined the broker. A closed
 * stage must mount none of that and must not connect; it opens (and
 * connects) if the viewer turns out to be a player after logging in.
 */

const store = vi.hoisted(() => {
  // SettingPopup → VoiceParameters → services/speech reads this global at import.
  (window as unknown as { meSpeak: unknown }).meSpeak = {
    loadVoice: () => {},
    speak: () => {},
    stop: () => {},
  };
  return {
    ready: false,
    canPlay: false,
    stageOpenToViewer: false,
    status: "OFFLINE",
    loadResult: true as boolean | Record<string, unknown>,
    loadStage: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(() => Promise.resolve()),
    disconnectSync: vi.fn(),
    triggerReloadStreams: vi.fn(),
  };
});
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const s = reactive(store);
  s.loadStage = vi.fn(() => Promise.resolve(s.loadResult));
  s.connect = vi.fn(() => {
    s.status = "LIVE";
  });
  return { useStageStore: () => s };
});
// pinia's storeToRefs only wraps refs/reactives; the stub holds plain values.
vi.mock("pinia", async (importOriginal) => {
  const { toRefs } = await import("vue");
  return {
    ...(await importOriginal<typeof import("pinia")>()),
    storeToRefs: (s: object) => toRefs(s as Record<string, unknown>),
  };
});
vi.mock("@stores/pinia/auth", () => ({
  useAuthStore: () => ({ holdForStage: () => () => {}, dropEndedSession: vi.fn() }),
}));
vi.mock("@composables/usePageWakeRecovery", () => ({ usePageWakeRecovery: vi.fn() }));
vi.mock("vue-router", () => ({ useRoute: () => ({ params: { url: "demo" } }) }));
vi.mock("utils/auth", () => ({ loggedIn: false }));

import { useStageStore } from "@stores/pinia/stage";
import Layout from "./Layout.vue";

const stub = (name: string) => ({ name, template: `<div data-stub="${name}"></div>` });
const stubs = Object.fromEntries(
  [
    "Logo",
    "SettingPopup",
    "Chat",
    "PlayerChat",
    "StageToolbox",
    "Board",
    "AudioPlayer",
    "Preloader",
    "LoginPrompt",
    "ReauthPrompt",
    "ConnectionStatus",
    "MasqueradingStatus",
  ].map((n) => [n, stub(n)]),
);
// Shell renders only its slot; keep the real provide-tree out of the test.
stubs.Shell = { name: "Shell", template: "<div><slot /></div>" };

const s = () => useStageStore() as unknown as typeof store;
const mounted: Array<{ unmount: () => void }> = [];
const mountLayout = () => {
  const w = mount(Layout, { global: { stubs, mocks: { $t: (k: string) => k } } });
  mounted.push(w);
  return w;
};
const has = (w: ReturnType<typeof mountLayout>, name: string) =>
  w.find(`[data-stub="${name}"]`).exists();

beforeEach(() => {
  s().ready = false;
  s().canPlay = false;
  s().stageOpenToViewer = false;
  s().status = "OFFLINE";
  s().loadResult = true;
  s().connect.mockClear();
});
afterEach(() => mounted.splice(0).forEach((w) => w.unmount()));

describe("live Layout on a stage closed to the viewer", () => {
  it("mounts nothing behind the curtain and does not join the broker", async () => {
    const w = mountLayout();
    await flushPromises();
    s().ready = true;
    await nextTick();
    expect(has(w, "Preloader")).toBe(true);
    expect(has(w, "Board")).toBe(false);
    expect(has(w, "AudioPlayer")).toBe(false);
    expect(has(w, "Chat")).toBe(false);
    // The login prompt stays: a player can sign in from the curtain.
    expect(has(w, "LoginPrompt")).toBe(true);
    expect(s().connect).not.toHaveBeenCalled();
  });

  it("opens and connects once the viewer becomes a player", async () => {
    const w = mountLayout();
    await flushPromises();
    s().ready = true;
    await nextTick();
    expect(s().connect).not.toHaveBeenCalled();

    s().stageOpenToViewer = true;
    s().canPlay = true;
    await nextTick();
    expect(s().connect).toHaveBeenCalledTimes(1);
    expect(has(w, "Board")).toBe(true);
    expect(has(w, "AudioPlayer")).toBe(true);
    expect(has(w, "StageToolbox")).toBe(true);
  });
});

describe("live Layout on an open stage", () => {
  it("connects after the load and mounts the stage", async () => {
    s().stageOpenToViewer = true;
    const w = mountLayout();
    await flushPromises();
    expect(s().connect).toHaveBeenCalledTimes(1);
    s().ready = true;
    await nextTick();
    expect(has(w, "Board")).toBe(true);
    expect(has(w, "AudioPlayer")).toBe(true);
    expect(has(w, "StageToolbox")).toBe(false);
  });

  it("does not connect when the load failed", async () => {
    s().stageOpenToViewer = true;
    s().loadResult = false;
    mountLayout();
    await flushPromises();
    expect(s().connect).not.toHaveBeenCalled();
  });
});
