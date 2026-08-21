// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * Embedded-meeting tile: load / fail / timeout / self-heal states and every
 * path of the topbar "Refresh streams" signal (`stageStore.meetingRefreshKey`):
 *   - failed embed      → remount (any role, no prompt)
 *   - audience viewer   → remount (no camera/mic, so a rejoin is harmless)
 *   - performer, loaded → confirmation dialog; OK remounts, Cancel does nothing
 */

const { modalConfirm } = vi.hoisted(() => ({ modalConfirm: vi.fn() }));
vi.mock("ant-design-vue", () => ({ Modal: { confirm: modalConfirm } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("./composable", () => ({
  useJitsiEndpoint: () => ({ host: "meet.test", httpScheme: "https" }),
}));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({ canPlay: true, meetingRefreshKey: 0, activeMovable: false });
  return { useStageStore: () => store };
});
vi.mock("@stores/pinia/user", () => ({
  useUserStore: () => ({ chatname: "Tester", user: null }),
}));

import { useStageStore } from "@stores/pinia/stage";
import MeetingObject from "./index.vue";

type StoreMock = { canPlay: boolean; meetingRefreshKey: number };
const store = () => useStageStore() as unknown as StoreMock;

const TIMEOUT_MS = 15000;

const mounted: Array<{ unmount: () => void }> = [];
function mountTile() {
  const w = mount(MeetingObject, {
    props: { object: { id: "m1", type: "meeting", name: "room-1", w: 640, h: 360 } },
    global: {
      mocks: { $t: (k: string) => k },
      stubs: { AppObject: { template: "<div><slot name='render' /></div>" } },
    },
  });
  mounted.push(w);
  return w;
}

const iframe = (w: ReturnType<typeof mountTile>) => w.find("iframe");
const failedCard = (w: ReturnType<typeof mountTile>) => w.find(".failed");
const spinner = (w: ReturnType<typeof mountTile>) => w.find("img.overlay");

async function refresh() {
  store().meetingRefreshKey += 1;
  await nextTick();
}

beforeEach(() => {
  vi.useFakeTimers();
  modalConfirm.mockReset();
  store().canPlay = true;
  store().meetingRefreshKey = 0;
});
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
});

describe("MeetingObject load states", () => {
  it("shows the spinner until the iframe loads, then the meeting", async () => {
    const w = mountTile();
    expect(spinner(w).exists()).toBe(true);
    expect(iframe(w).attributes("src")).toMatch(/^https:\/\/meet\.test\/room-1#/);
    await iframe(w).trigger("load");
    expect(spinner(w).exists()).toBe(false);
    expect(failedCard(w).exists()).toBe(false);
    expect(iframe(w).isVisible()).toBe(true);
  });

  it("shows the failed card when the iframe errors", async () => {
    const w = mountTile();
    await iframe(w).trigger("error");
    expect(failedCard(w).exists()).toBe(true);
    expect(spinner(w).exists()).toBe(false);
    expect(iframe(w).isVisible()).toBe(false);
  });

  it("shows the failed card when nothing loads before the timeout", async () => {
    const w = mountTile();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(failedCard(w).exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(failedCard(w).exists()).toBe(true);
  });

  it("self-heals: a late load after the timeout clears the failed card", async () => {
    const w = mountTile();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(failedCard(w).exists()).toBe(true);
    await iframe(w).trigger("load");
    expect(failedCard(w).exists()).toBe(false);
    expect(iframe(w).isVisible()).toBe(true);
  });

  it("does not time out once the iframe has loaded", async () => {
    const w = mountTile();
    await iframe(w).trigger("load");
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);
    expect(failedCard(w).exists()).toBe(false);
  });

  it("in-tile Refresh meeting button remounts the iframe and restarts the timer", async () => {
    const w = mountTile();
    await iframe(w).trigger("error");
    const before = iframe(w).element;
    await failedCard(w).find("button").trigger("click");
    await flushPromises();
    expect(iframe(w).element).not.toBe(before);
    expect(failedCard(w).exists()).toBe(false);
    expect(spinner(w).exists()).toBe(true);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(failedCard(w).exists()).toBe(true);
  });

  it("audience iframes only get autoplay; performers get camera/mic", async () => {
    expect(mountTile().find("iframe").attributes("allow")).toBe(
      "camera; microphone; display-capture; autoplay",
    );
    store().canPlay = false;
    expect(mountTile().find("iframe").attributes("allow")).toBe("autoplay");
  });
});

describe("MeetingObject topbar refresh signal", () => {
  it("performer + failed embed: remounts without asking", async () => {
    const w = mountTile();
    await iframe(w).trigger("error");
    const before = iframe(w).element;
    await refresh();
    expect(modalConfirm).not.toHaveBeenCalled();
    expect(iframe(w).element).not.toBe(before);
    expect(failedCard(w).exists()).toBe(false);
    expect(spinner(w).exists()).toBe(true);
  });

  it("performer + timed-out embed: remounts without asking", async () => {
    const w = mountTile();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const before = iframe(w).element;
    await refresh();
    expect(modalConfirm).not.toHaveBeenCalled();
    expect(iframe(w).element).not.toBe(before);
  });

  it("audience + loaded meeting: remounts without asking", async () => {
    store().canPlay = false;
    const w = mountTile();
    await iframe(w).trigger("load");
    const before = iframe(w).element;
    await refresh();
    expect(modalConfirm).not.toHaveBeenCalled();
    expect(iframe(w).element).not.toBe(before);
    expect(spinner(w).exists()).toBe(true);
  });

  it("audience + still loading: remounts without asking", async () => {
    store().canPlay = false;
    const w = mountTile();
    const before = iframe(w).element;
    await refresh();
    expect(modalConfirm).not.toHaveBeenCalled();
    expect(iframe(w).element).not.toBe(before);
  });

  it("performer + loaded meeting: asks for confirmation and does not touch the iframe", async () => {
    const w = mountTile();
    await iframe(w).trigger("load");
    const before = iframe(w).element;
    await refresh();
    expect(modalConfirm).toHaveBeenCalledTimes(1);
    const opts = modalConfirm.mock.calls[0][0];
    expect(opts.title).toBe("refresh_meeting");
    expect(opts.okText).toBe("refresh_meeting");
    expect(opts.okButtonProps).toEqual({ danger: true });
    expect(iframe(w).element).toBe(before);
    expect(spinner(w).exists()).toBe(false);
  });

  it("performer confirms: the meeting is force-reloaded", async () => {
    const w = mountTile();
    await iframe(w).trigger("load");
    const before = iframe(w).element;
    await refresh();
    modalConfirm.mock.calls[0][0].onOk();
    await nextTick();
    expect(iframe(w).element).not.toBe(before);
    expect(spinner(w).exists()).toBe(true);
    // Remount restarts the load timer: a rejoin that never loads still fails over.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(failedCard(w).exists()).toBe(true);
  });

  it("performer cancels: nothing happens", async () => {
    const w = mountTile();
    await iframe(w).trigger("load");
    const before = iframe(w).element;
    await refresh();
    const opts = modalConfirm.mock.calls[0][0];
    opts.onCancel?.();
    await nextTick();
    expect(iframe(w).element).toBe(before);
    expect(spinner(w).exists()).toBe(false);
    expect(failedCard(w).exists()).toBe(false);
  });

  it("performer + still loading (not yet failed): asks rather than silently remounting", async () => {
    const w = mountTile();
    const before = iframe(w).element;
    await refresh();
    expect(modalConfirm).toHaveBeenCalledTimes(1);
    expect(iframe(w).element).toBe(before);
  });

  it("each click is handled independently (two signals → two prompts)", async () => {
    const w = mountTile();
    await iframe(w).trigger("load");
    await refresh();
    await refresh();
    expect(modalConfirm).toHaveBeenCalledTimes(2);
  });
});
