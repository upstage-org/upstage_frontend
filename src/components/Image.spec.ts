// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import AppImage from "./Image.vue";

/**
 * The component preloads every src change through a JS Image and only
 * swaps the rendered <img> once the new file has loaded; on a failed
 * preload it keeps the last good frame. These tests drive that contract
 * with a controllable Image stub (jsdom never loads real images).
 */
class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = "";
  set src(value: string) {
    this._src = value;
    FakeImage.instances.push(this);
  }
  get src() {
    return this._src;
  }
}

const lastPreload = () => FakeImage.instances[FakeImage.instances.length - 1];

const renderedImg = (wrapper: ReturnType<typeof mount>) => wrapper.find("img");

beforeEach(() => {
  FakeImage.instances = [];
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppImage load/display decoupling", () => {
  it("renders the initial src directly without preloading", () => {
    const wrapper = mount(AppImage, { props: { src: "/frames/a.png" } });
    expect(renderedImg(wrapper).attributes("src")).toBe("/frames/a.png");
    expect(FakeImage.instances).toHaveLength(0);
  });

  it("keeps the old frame visible until the new src has loaded, then swaps", async () => {
    const wrapper = mount(AppImage, { props: { src: "/frames/a.png" } });
    await wrapper.setProps({ src: "/frames/b.png" });
    // Still showing the old frame while /frames/b.png loads off-screen.
    expect(renderedImg(wrapper).attributes("src")).toBe("/frames/a.png");
    expect(lastPreload().src).toBe("/frames/b.png");
    lastPreload().onload?.();
    await nextTick();
    expect(renderedImg(wrapper).attributes("src")).toBe("/frames/b.png");
  });

  it("keeps the last good frame (no placeholder) when a later frame fails to load", async () => {
    const wrapper = mount(AppImage, { props: { src: "/frames/a.png" } });
    await renderedImg(wrapper).trigger("load");
    await wrapper.setProps({ src: "/frames/broken.png" });
    lastPreload().onerror?.();
    await nextTick();
    expect(renderedImg(wrapper).attributes("src")).toBe("/frames/a.png");
    expect(wrapper.html()).not.toContain("notfound.svg");
  });

  it("self-heals after a failed frame when the next src loads", async () => {
    const wrapper = mount(AppImage, { props: { src: "/frames/a.png" } });
    await renderedImg(wrapper).trigger("load");
    await wrapper.setProps({ src: "/frames/broken.png" });
    lastPreload().onerror?.();
    await wrapper.setProps({ src: "/frames/c.png" });
    lastPreload().onload?.();
    await nextTick();
    expect(renderedImg(wrapper).attributes("src")).toBe("/frames/c.png");
  });

  it("shows the notfound placeholder only when nothing has ever displayed", async () => {
    const wrapper = mount(AppImage, { props: { src: "/frames/missing.png" } });
    await renderedImg(wrapper).trigger("error");
    expect(renderedImg(wrapper).attributes("src")).toContain("notfound.svg");
    // A good src arriving later replaces the placeholder.
    await wrapper.setProps({ src: "/frames/a.png" });
    lastPreload().onload?.();
    await nextTick();
    expect(renderedImg(wrapper).attributes("src")).toBe("/frames/a.png");
  });

  it("suppresses the placeholder with noFallback", async () => {
    const wrapper = mount(AppImage, {
      props: { src: "/frames/missing.png", noFallback: true },
    });
    await renderedImg(wrapper).trigger("error");
    expect(wrapper.html()).not.toContain("notfound.svg");
  });

  it("drops stale out-of-order preload results", async () => {
    const wrapper = mount(AppImage, { props: { src: "/frames/a.png" } });
    await renderedImg(wrapper).trigger("load");
    await wrapper.setProps({ src: "/frames/b.png" });
    const slowB = lastPreload();
    await wrapper.setProps({ src: "/frames/c.png" });
    const fastC = lastPreload();
    fastC.onload?.();
    slowB.onload?.(); // finishes late — must not win
    await nextTick();
    expect(renderedImg(wrapper).attributes("src")).toBe("/frames/c.png");
  });

  it("cancels a pending preload when src flaps back to the displayed frame", async () => {
    const wrapper = mount(AppImage, { props: { src: "/frames/a.png" } });
    await renderedImg(wrapper).trigger("load");
    await wrapper.setProps({ src: "/frames/b.png" });
    const pendingB = lastPreload();
    await wrapper.setProps({ src: "/frames/a.png" }); // back before B loaded
    pendingB.onload?.();
    await nextTick();
    expect(renderedImg(wrapper).attributes("src")).toBe("/frames/a.png");
  });
});
