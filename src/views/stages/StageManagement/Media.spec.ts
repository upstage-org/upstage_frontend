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
    // A lone RTMP feed sits in the Streams-bar row ("video & streams").
    expect(rowTypes()).toEqual(["avatar", "audio", "video"]);

    // Moving an audio item shifts first-appearance positions in the flat
    // array; the rendered rows must not jump around because of it.
    await dragBetween(wrapper, "20", "21");
    expect(rowTypes()).toEqual(["avatar", "audio", "video"]);
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

/**
 * Reported 2026-09, stage "turn": three streams were moved to the front of
 * the list; two stuck, the third "remained at the end" on every attempt even
 * though Save reported success each time.
 *
 * On stage, `video` assets (uploaded clips) and `stream` assets (RTMP feeds)
 * share ONE tool bar (`tools.videos`, flat-list order). The grid gave each
 * type its own row and rejected drops between rows, so an item of the other
 * type could not be moved relative to them at all — and Save happily
 * re-saved the unchanged order.
 */
describe("Stage Management > Media — clips and feeds share the Streams bar", () => {
  const streamsBarAssets = () => [
    { id: "40", name: "Opening clip", assetType: { name: "video" } },
    { id: "41", name: "Interval clip", assetType: { name: "video" } },
    { id: "10", name: "ava-red", assetType: { name: "avatar" } },
    { id: "50", name: "DOhen", assetType: { name: "video" } },
    { id: "51", name: "DO-alles", assetType: { name: "video" } },
    { id: "60", name: "DO-eva", assetType: { name: "stream" } },
  ];
  /** The Streams bar as the stage builds it: video + stream, flat order. */
  const streamsBarOrder = (ids: string[], assets: { id: string; assetType: { name: string } }[]) =>
    ids.filter((id) =>
      ["video", "stream"].includes(assets.find((a) => a.id === id)!.assetType.name.toLowerCase()),
    );

  const dragBetween = async (
    wrapper: ReturnType<typeof mountMedia>,
    fromId: string,
    toId: string,
  ) => {
    const dataTransfer = makeDataTransfer();
    const tiles = wrapper.findAll(".media-preview");
    await tiles.find((t) => t.attributes("id") === fromId)!.trigger("dragstart", { dataTransfer });
    await tiles.find((t) => t.attributes("id") === toId)!.trigger("dragover", { dataTransfer });
    await tiles.find((t) => t.attributes("id") === toId)!.trigger("drop", { dataTransfer });
  };

  it("shows clips and feeds in one row, in Streams-bar order", () => {
    const wrapper = mountMedia(streamsBarAssets());
    const rows = wrapper.findAll(".reorder-grid > .columns");
    expect(rows).toHaveLength(2);
    expect(rows[1].find(".type-caption").text()).toBe("video & streams (5)");
    expect(rows[1].findAll(".media-preview").map((t) => t.attributes("id"))).toEqual([
      "40",
      "41",
      "50",
      "51",
      "60",
    ]);
  });

  it("moves all three items to the front — including the one of the other type — and saves that order", async () => {
    const assets = streamsBarAssets();
    const wrapper = mountMedia(assets);
    await dragBetween(wrapper, "50", "40"); // DOhen first
    await dragBetween(wrapper, "51", "40"); // DO-alles second
    await dragBetween(wrapper, "60", "40"); // DO-eva (a feed) third — used to be refused

    await wrapper.find("button").trigger("click");
    await new Promise((resolve) => setTimeout(resolve));

    const savedIds = save.mock.calls[0][2] as string[];
    expect(streamsBarOrder(savedIds, assets)).toEqual(["50", "51", "60", "40", "41"]);
    // Nothing lost, nothing duplicated, other bars untouched.
    expect([...savedIds].sort()).toEqual(assets.map((a) => a.id).sort());
    expect(savedIds.filter((id) => id === "10")).toEqual(["10"]);
  });

  it("marks a tile of the other stream type as a valid drop target", async () => {
    const wrapper = mountMedia(streamsBarAssets());
    const dataTransfer = makeDataTransfer();
    const tiles = wrapper.findAll(".media-preview");
    const feed = tiles.find((t) => t.attributes("id") === "60")!;
    const clip = tiles.find((t) => t.attributes("id") === "40")!;
    await feed.trigger("dragstart", { dataTransfer });
    await clip.trigger("dragover", { dataTransfer });
    expect(clip.classes()).toContain("dropzone");
  });

  it("matches type names the way the stage does (case, legacy aliases)", () => {
    const wrapper = mountMedia([
      { id: "1", name: "clip", assetType: { name: "Video" } },
      { id: "2", name: "feed", assetType: { name: "streaming" } },
      // Older payloads carried the type as a bare string.
      { id: "3", name: "feed2", assetType: "stream" as unknown as { name: string } },
    ]);
    expect(wrapper.findAll(".reorder-grid > .columns")).toHaveLength(1);
    expect(tileIds(wrapper)).toEqual(["1", "2", "3"]);
  });

  it("still draws each tile by its own type inside the shared row", () => {
    const wrapper = mountMedia(streamsBarAssets());
    expect(wrapper.find('[id="60"] .name-only-label').text()).toBe("DO-eva");
    expect(wrapper.find('[id="40"] .video-reorder-cell').exists()).toBe(true);
    expect(wrapper.find('[id="40"] .name-only-cell').exists()).toBe(false);
  });

  it("still refuses a drop between different tool bars", async () => {
    const wrapper = mountMedia(streamsBarAssets());
    const before = tileIds(wrapper);
    await dragBetween(wrapper, "60", "10"); // feed onto avatar
    expect(tileIds(wrapper)).toEqual(before);
  });
});
