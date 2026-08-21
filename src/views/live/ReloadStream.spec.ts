// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * Topbar "Refresh streams" button: visible only when there is something
 * refreshable on stage, and fires exactly the store signals for the object
 * kinds present (jitsi/RTMP → force-reload tick; meeting → meeting key).
 */

vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    objects: [] as Array<Record<string, unknown>>,
    triggerForceReloadStreams: vi.fn(),
    refreshMeeting: vi.fn(),
  });
  return { useStageStore: () => store };
});

import { useStageStore } from "@stores/pinia/stage";
import ReloadStream from "./ReloadStream.vue";

type StoreMock = {
  objects: Array<Record<string, unknown>>;
  triggerForceReloadStreams: ReturnType<typeof vi.fn>;
  refreshMeeting: ReturnType<typeof vi.fn>;
};
const store = () => useStageStore() as unknown as StoreMock;

const mounted: Array<{ unmount: () => void }> = [];
function mountButton() {
  const w = mount(ReloadStream, {
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { "a-tooltip": { template: "<div><slot /></div>" } },
    },
  });
  mounted.push(w);
  return w;
}

const MEETING = { id: "m", type: "meeting" };
const JITSI = { id: "j", type: "jitsi" };
const RTMP = { id: "r", type: "stream", isRTMP: true };
const AVATAR = { id: "a", type: "avatar" };
const NON_LIVE_STREAM = { id: "s", type: "stream" };

beforeEach(() => {
  store().objects = [];
  store().triggerForceReloadStreams.mockClear();
  store().refreshMeeting.mockClear();
});
afterEach(() => mounted.splice(0).forEach((w) => w.unmount()));

describe("ReloadStream visibility", () => {
  it("is hidden on an empty stage", () => {
    expect(mountButton().find("#reload-stream").exists()).toBe(false);
  });

  it("is hidden when only non-refreshable objects are on stage", () => {
    store().objects = [AVATAR, NON_LIVE_STREAM];
    expect(mountButton().find("#reload-stream").exists()).toBe(false);
  });

  it.each([
    ["meeting", MEETING],
    ["jitsi", JITSI],
    ["rtmp", RTMP],
  ])("is shown for a %s tile", (_name, obj) => {
    store().objects = [obj];
    const w = mountButton();
    expect(w.find("#reload-stream").exists()).toBe(true);
    expect(w.find("button i.fa-sync").exists()).toBe(true);
    expect(w.find("button").attributes("aria-label")).toBe("refresh_streams");
  });

  it("appears and disappears reactively as tiles come and go", async () => {
    const w = mountButton();
    expect(w.find("#reload-stream").exists()).toBe(false);
    store().objects = [MEETING];
    await w.vm.$nextTick();
    expect(w.find("#reload-stream").exists()).toBe(true);
    store().objects = [];
    await w.vm.$nextTick();
    expect(w.find("#reload-stream").exists()).toBe(false);
  });
});

describe("ReloadStream click", () => {
  it("meeting only → meeting signal only", async () => {
    store().objects = [MEETING];
    await mountButton().find("button").trigger("mousedown");
    expect(store().refreshMeeting).toHaveBeenCalledTimes(1);
    expect(store().triggerForceReloadStreams).not.toHaveBeenCalled();
  });

  it("jitsi only → force-reload only", async () => {
    store().objects = [JITSI];
    await mountButton().find("button").trigger("mousedown");
    expect(store().triggerForceReloadStreams).toHaveBeenCalledTimes(1);
    expect(store().refreshMeeting).not.toHaveBeenCalled();
  });

  it("rtmp only → force-reload only", async () => {
    store().objects = [RTMP];
    await mountButton().find("button").trigger("mousedown");
    expect(store().triggerForceReloadStreams).toHaveBeenCalledTimes(1);
    expect(store().refreshMeeting).not.toHaveBeenCalled();
  });

  it("meeting + individual stream → both signals, once each", async () => {
    store().objects = [MEETING, JITSI, RTMP];
    await mountButton().find("button").trigger("mousedown");
    expect(store().triggerForceReloadStreams).toHaveBeenCalledTimes(1);
    expect(store().refreshMeeting).toHaveBeenCalledTimes(1);
  });
});
