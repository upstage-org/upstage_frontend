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

describe("Stage Management > Media — mixed asset types", () => {
  // Chronological assignment interleaves types in the flat assets array.
  const mixedAssets = () => [
    { id: "10", name: "ava-red", assetType: { name: "avatar" } },
    { id: "20", name: "drum-loop", assetType: { name: "audio" } },
    { id: "60", name: "Camera One", assetType: { name: "stream" } },
    { id: "11", name: "ava-blue", assetType: { name: "avatar" } },
    { id: "21", name: "sea-waves", assetType: { name: "audio" } },
  ];

  const dragBetween = async (
    wrapper: ReturnType<typeof mountMedia>,
    fromId: string,
    toId: string,
  ) => {
    const dataTransfer = makeDataTransfer();
    const tiles = wrapper.findAll(".media-preview");
    await tiles.find((t) => t.attributes("id") === fromId)!.trigger("dragstart", { dataTransfer });
    await tiles.find((t) => t.attributes("id") === toId)!.trigger("drop", { dataTransfer });
  };

  it("keeps the type rows in a stable order across drags", async () => {
    const wrapper = mountMedia(mixedAssets());
    const rowTypes = () => wrapper.findAll(".type-caption").map((c) => c.text().split(" ")[0]);
    expect(rowTypes()).toEqual(["avatar", "audio", "stream"]);

    // Moving an audio item shifts first-appearance positions in the flat
    // array; the rendered rows must not jump around because of it.
    await dragBetween(wrapper, "20", "21");
    expect(rowTypes()).toEqual(["avatar", "audio", "stream"]);
    expect(tileIds(wrapper)).toContain("20");
  });

  it("ignores a drop onto a tile of a different type", async () => {
    const wrapper = mountMedia(mixedAssets());
    const before = tileIds(wrapper);
    await dragBetween(wrapper, "20", "10"); // audio onto avatar
    expect(tileIds(wrapper)).toEqual(before);
  });

  it("renders audio and stream tiles as centred name-only labels", () => {
    const wrapper = mountMedia(mixedAssets());
    const labels = wrapper.findAll(".name-only-label").map((l) => l.text());
    expect(labels).toEqual(expect.arrayContaining(["drum-loop", "sea-waves", "Camera One"]));
    // No icon inside audio tiles and no generic Asset <img> for streams.
    const audioTile = wrapper.find('[id="20"]');
    expect(audioTile.findComponent({ name: "Icon" }).exists()).toBe(false);
    const streamTile = wrapper.find('[id="60"]');
    expect(streamTile.find("img").exists()).toBe(false);
  });
});
