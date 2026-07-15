// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * Volume popup contract: the slider adjusts THIS browser's playback live
 * (so the level can be found by ear), but nothing persists — no store
 * write, no shapeObject broadcast — until Save. Closing unsaved puts the
 * element back at the level it had when the popup opened.
 */

const { shapeObject, setStreamLocalVolume, storeState } = vi.hoisted(() => ({
  shapeObject: vi.fn(),
  setStreamLocalVolume: vi.fn(),
  storeState: { activeObject: null as Record<string, unknown> | null },
}));

vi.mock("@stores/pinia/stage", () => ({
  useStageStore: () => ({
    get activeObject() {
      return storeState.activeObject;
    },
    shapeObject,
    setStreamLocalVolume,
    streamLocalVolume: () => 80,
  }),
}));

import VolumeParameters from "./VolumeParameters.vue";

const mountPopup = (object: Record<string, unknown>) => {
  storeState.activeObject = object;
  return mount(VolumeParameters, {
    global: {
      mocks: { $t: (key: string) => key },
      stubs: {
        "a-slider": {
          props: ["value"],
          emits: ["update:value"],
          template: `<input type="range" min="0" max="100" :value="value"
            @input="$emit('update:value', Number($event.target.value))" />`,
        },
      },
    },
  });
};

let mediaEl: HTMLAudioElement;

beforeEach(() => {
  vi.clearAllMocks();
  // The tile's sounding element, as rendered by Jitsi.vue (sibling <audio>)
  // and LiveStreamPlayer.vue / Object.vue (<video>): id = "video" + object id.
  mediaEl = document.createElement("audio");
  mediaEl.id = "videoo1";
  mediaEl.volume = 0.8;
  document.body.appendChild(mediaEl);
});

afterEach(() => {
  mediaEl.remove();
});

describe("VolumeParameters live preview", () => {
  it("applies slider moves to the media element immediately, persisting nothing", async () => {
    const wrapper = mountPopup({ id: "o1", type: "jitsi" });

    await wrapper.find("input[type=range]").setValue("30");
    expect(mediaEl.volume).toBeCloseTo(0.3);
    expect(setStreamLocalVolume).not.toHaveBeenCalled();
    expect(shapeObject).not.toHaveBeenCalled();
  });

  it("reverts the element when closed without saving", async () => {
    const wrapper = mountPopup({ id: "o1", type: "jitsi" });

    await wrapper.find("input[type=range]").setValue("5");
    expect(mediaEl.volume).toBeCloseTo(0.05);

    wrapper.unmount();
    // Back to the store level the popup opened with (80).
    expect(mediaEl.volume).toBeCloseTo(0.8);
    expect(setStreamLocalVolume).not.toHaveBeenCalled();
  });

  it("Save persists a live tile's level to the local store and keeps it", async () => {
    const wrapper = mountPopup({ id: "o1", type: "jitsi" });

    await wrapper.find("input[type=range]").setValue("30");
    await wrapper.find("button").trigger("click");
    expect(setStreamLocalVolume).toHaveBeenCalledWith("o1", 30);
    expect(shapeObject).not.toHaveBeenCalled();
    expect(wrapper.emitted("close")).toBeTruthy();

    wrapper.unmount();
    expect(mediaEl.volume).toBeCloseTo(0.3);
  });

  it("Save broadcasts a video file's level via shapeObject", async () => {
    const object = { id: "o1", type: "video", volume: 80 };
    const wrapper = mountPopup(object);

    await wrapper.find("input[type=range]").setValue("55");
    await wrapper.find("button").trigger("click");
    expect(shapeObject).toHaveBeenCalledWith({ ...object, volume: 55 });
    expect(setStreamLocalVolume).not.toHaveBeenCalled();
  });
});
