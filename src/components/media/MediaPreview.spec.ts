// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * Studio media list preview cell. Regression guard for video preview: the
 * list shows a first-frame thumbnail, and clicking it must open a playable
 * <video controls> (this once silently disappeared when the thumbnail
 * replaced the old inline <video>). Audio stays an inline player, images an
 * enlargeable <a-image>.
 */

import MediaPreview from "./MediaPreview.vue";
import type { Media } from "models/studio";

// a-modal renders into a portal; stub it as an inline slot gated on `open`.
const AModalStub = {
  props: ["open", "title"],
  emits: ["update:open"],
  template: '<div v-if="open" class="modal-stub" :data-title="title"><slot /></div>',
};

const makeMedia = (type: string, overrides = {}) => ({
  id: "1",
  name: "clip one",
  fileLocation: "media/clip-one.mp4",
  description: "{}",
  assetType: { name: type },
  ...overrides,
});

const mountPreview = (media: object) =>
  mount(MediaPreview, {
    props: { media: media as Media },
    global: {
      mocks: { $t: (key: string) => key },
      stubs: {
        "a-modal": AModalStub,
        "a-image": true,
        "a-popover": true,
        VideoFirstFrameThumb: true,
      },
    },
  });

describe("MediaPreview", () => {
  it("video: shows a thumbnail trigger and no player until clicked", () => {
    const wrapper = mountPreview(makeMedia("video"));
    const trigger = wrapper.find('[data-testid="video-preview-trigger"]');
    expect(trigger.exists()).toBe(true);
    expect(trigger.element.tagName).toBe("BUTTON");
    expect(trigger.findComponent({ name: "VideoFirstFrameThumb" }).exists()).toBe(true);
    expect(wrapper.find('[data-testid="video-preview-player"]').exists()).toBe(false);
  });

  it("video: clicking the thumbnail opens a playable video with controls", async () => {
    const wrapper = mountPreview(makeMedia("video"));
    await wrapper.find('[data-testid="video-preview-trigger"]').trigger("click");

    const player = wrapper.find('[data-testid="video-preview-player"]');
    expect(player.exists()).toBe(true);
    expect(player.element.tagName).toBe("VIDEO");
    expect(player.attributes("controls")).toBeDefined();
    expect(player.attributes("src")).toContain("media/clip-one.mp4");
    expect(wrapper.find(".modal-stub").attributes("data-title")).toBe("clip one");
  });

  it("video: closing the modal removes the player (stops playback)", async () => {
    const wrapper = mountPreview(makeMedia("video"));
    await wrapper.find('[data-testid="video-preview-trigger"]').trigger("click");
    expect(wrapper.find('[data-testid="video-preview-player"]').exists()).toBe(true);

    await wrapper.findComponent(AModalStub).vm.$emit("update:open", false);
    expect(wrapper.find('[data-testid="video-preview-player"]').exists()).toBe(false);
  });

  it("audio: renders an inline audio player with controls", () => {
    const wrapper = mountPreview(makeMedia("audio", { fileLocation: "media/a.mp3" }));
    const audio = wrapper.find("audio");
    expect(audio.exists()).toBe(true);
    expect(audio.attributes("controls")).toBeDefined();
    expect(wrapper.find('[data-testid="video-preview-trigger"]').exists()).toBe(false);
  });

  it("image types: render an enlargeable image, not the video trigger", () => {
    const wrapper = mountPreview(makeMedia("avatar", { fileLocation: "media/a.png" }));
    expect(wrapper.findComponent({ name: "a-image" }).exists()).toBe(true);
    expect(wrapper.find('[data-testid="video-preview-trigger"]').exists()).toBe(false);
    expect(wrapper.find("video").exists()).toBe(false);
  });
});
