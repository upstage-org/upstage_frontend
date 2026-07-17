// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

/**
 * Stage Management > Media: drag-and-drop reordering of the media assigned
 * to a stage, persisted with the top-right Save button (assignMedia keeps
 * the parent_stage rows in the order sent — that order IS the on-stage
 * toolbar order). This spec covers the wiring that once silently broke:
 * Media.vue held the list in a non-reactive plain array, so Reorder's
 * update:modelValue went nowhere and drops appeared to do nothing.
 */

const { saveStageMedia, save } = vi.hoisted(() => ({
  saveStageMedia: vi.fn(),
  save: vi.fn().mockResolvedValue({}),
}));

vi.mock("services/graphql", () => ({
  stageGraph: { saveStageMedia },
}));

vi.mock("services/graphql/composable", () => ({
  useMutation: () => ({ loading: ref(false), save }),
}));

import Media from "./Media.vue";

const makeAssets = () => [
  { id: "1", name: "one", assetType: { name: "avatar" } },
  { id: "2", name: "two", assetType: { name: "avatar" } },
  { id: "3", name: "three", assetType: { name: "avatar" } },
];

const clearCache = vi.fn();

const mountMedia = (assets = makeAssets()) =>
  mount(Media, {
    global: {
      provide: {
        stage: ref({ id: "9", assets }),
        clearCache,
      },
      mocks: { $t: (key: string) => key },
      stubs: { Asset: true, Icon: true, VideoFirstFrameThumb: true },
    },
  });

/** Minimal DataTransfer stand-in (jsdom has none). */
const makeDataTransfer = () => {
  const data: Record<string, string> = {};
  return {
    setData: (type: string, value: string) => {
      data[type] = value;
    },
    getData: (type: string) => data[type] ?? "",
    setDragImage: () => {},
  };
};

const tileIds = (wrapper: ReturnType<typeof mountMedia>) =>
  wrapper.findAll(".media-preview").map((tile) => tile.attributes("id"));

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue({});
});

describe("Stage Management > Media — reorder and save", () => {
  it("reorders the thumbnails on drag and drop", async () => {
    const wrapper = mountMedia();
    expect(tileIds(wrapper)).toEqual(["1", "2", "3"]);

    const dataTransfer = makeDataTransfer();
    const tiles = wrapper.findAll(".media-preview");
    await tiles[0].trigger("dragstart", { dataTransfer });
    await tiles[2].trigger("drop", { dataTransfer });

    expect(tileIds(wrapper)).toEqual(["2", "3", "1"]);
  });

  it("saves the new order via assignMedia and clears the stage cache", async () => {
    const wrapper = mountMedia();

    const dataTransfer = makeDataTransfer();
    const tiles = wrapper.findAll(".media-preview");
    await tiles[2].trigger("dragstart", { dataTransfer });
    await tiles[0].trigger("drop", { dataTransfer });
    expect(tileIds(wrapper)).toEqual(["3", "1", "2"]);

    await wrapper.find("button").trigger("click");
    await new Promise((resolve) => setTimeout(resolve));

    expect(save).toHaveBeenCalledWith("Media order saved!", "9", ["3", "1", "2"]);
    expect(clearCache).toHaveBeenCalled();
  });

  it("leaves the stage's own array untouched until Save", async () => {
    const assets = makeAssets();
    const wrapper = mountMedia(assets);

    const dataTransfer = makeDataTransfer();
    const tiles = wrapper.findAll(".media-preview");
    await tiles[0].trigger("dragstart", { dataTransfer });
    await tiles[1].trigger("drop", { dataTransfer });

    expect(tileIds(wrapper)).toEqual(["2", "1", "3"]);
    expect(assets.map((a) => a.id)).toEqual(["1", "2", "3"]);
  });
});
