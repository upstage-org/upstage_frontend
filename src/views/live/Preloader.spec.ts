// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * The curtain that covers the stage until it is loaded and clicked, and that
 * keeps a closed stage closed to the audience. Issue #1574: pressing Play on a
 * replay drew it again and nothing could dismiss it, because the store turns
 * `canPlay` off while a recording plays.
 */

vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const state = {
    preloading: false,
    preloadableAssets: [] as string[],
    model: null as Record<string, unknown> | null,
    canPlay: false,
    masquerading: false,
    backdropColor: "gray",
    get ready(): boolean {
      return !!this.model && !this.preloading;
    },
    SET_PRELOADING_STATUS(value: boolean) {
      this.preloading = value;
    },
  };
  const store = reactive(state);
  return { useStageStore: () => store };
});
vi.mock("services/graphql/composable", async () => {
  const { ref } = await import("vue");
  return { useAttribute: () => ref(undefined) };
});
vi.mock("animejs", () => ({ animate: vi.fn() }));

import { useStageStore } from "@stores/pinia/stage";
import Preloader from "./Preloader.vue";

type StoreMock = {
  preloading: boolean;
  preloadableAssets: string[];
  model: Record<string, unknown> | null;
  canPlay: boolean;
  masquerading: boolean;
};
const store = () => useStageStore() as unknown as StoreMock;

const STAGE = { id: 1, name: "Stage", status: "rehearsal", events: [{ mqttTimestamp: 1 }] };

const mounted: Array<{ unmount: () => void }> = [];
function mountPreloader(replaying?: boolean) {
  const wrapper = mount(Preloader, {
    global: {
      mocks: { $t: (key: string) => key },
      provide: replaying === undefined ? {} : { replaying },
      stubs: { transition: false },
    },
  });
  mounted.push(wrapper);
  return wrapper;
}
const curtain = (wrapper: ReturnType<typeof mountPreloader>) => wrapper.find("section.hero");

beforeEach(() => {
  store().preloading = false;
  store().preloadableAssets = [];
  store().model = { ...STAGE };
  store().canPlay = true;
  store().masquerading = false;
});
afterEach(() => mounted.splice(0).forEach((w) => w.unmount()));

describe("Preloader on a replay", () => {
  it("stays dismissed when playback starts (canPlay turns false)", async () => {
    const wrapper = mountPreloader(true);
    expect(curtain(wrapper).text()).toContain("click anywhere to continue");
    await curtain(wrapper).trigger("click");
    expect(curtain(wrapper).exists()).toBe(false);

    // Play pressed: the store's publish gate turns the viewer into an audience member.
    store().canPlay = false;
    await nextTick();
    expect(curtain(wrapper).exists()).toBe(false);

    // Seeking re-runs the same path; the curtain must not come back either.
    store().canPlay = true;
    await nextTick();
    store().canPlay = false;
    await nextTick();
    expect(curtain(wrapper).exists()).toBe(false);
  });

  it("lets an audience member (no play permission) watch a recording", async () => {
    store().canPlay = false;
    const wrapper = mountPreloader(true);
    expect(curtain(wrapper).text()).toContain("click anywhere to continue");
    expect(curtain(wrapper).text()).not.toContain("not currently open");
    await curtain(wrapper).trigger("click");
    expect(curtain(wrapper).exists()).toBe(false);
  });

  it("explains a recording without events instead of offering to continue", () => {
    store().model = { ...STAGE, events: [] };
    const wrapper = mountPreloader(true);
    expect(curtain(wrapper).text()).toContain("replay_no_events_title");
    expect(curtain(wrapper).text()).not.toContain("click anywhere");
  });
});

describe("Preloader on a live stage", () => {
  it("keeps a stage that is not live closed to the audience", async () => {
    store().canPlay = false;
    const wrapper = mountPreloader();
    expect(curtain(wrapper).text()).toContain("not currently open to the public");
    await curtain(wrapper).trigger("click");
    expect(curtain(wrapper).exists()).toBe(true);
  });

  it("lets a player onto a stage that is not live, and an audience onto a live one", async () => {
    const player = mountPreloader();
    await curtain(player).trigger("click");
    expect(curtain(player).exists()).toBe(false);

    store().canPlay = false;
    store().model = { ...STAGE, status: "live" };
    const audience = mountPreloader();
    await curtain(audience).trigger("click");
    expect(curtain(audience).exists()).toBe(false);
  });
});
