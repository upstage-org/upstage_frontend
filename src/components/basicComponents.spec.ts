// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, inject, nextTick } from "vue";
import Asset from "./Asset.vue";
import CustomConfirm from "./CustomConfirm.vue";
import Icon from "./Icon.vue";
import Modal from "./Modal.vue";
import Selectable from "./Selectable.vue";

/**
 * Contract of the small shared components, as their callers rely on it:
 * props, emitted events, slot props and what Modal provides to descendants.
 */
const global = { mocks: { $t: (key: string) => key } };

afterEach(() => {
  // Modal teleports to <body>.
  document.body.innerHTML = "";
});

describe("Modal", () => {
  const mountModal = (props = {}, slots = {}) =>
    mount(Modal, {
      props,
      slots: { trigger: "<button class='open'>open</button>", content: "body text", ...slots },
      attachTo: document.body,
      global,
    });

  it("is closed until the trigger is clicked, then reports the change", async () => {
    const wrapper = mountModal({ id: "m1" });
    expect(document.querySelector(".modal")).toBeNull();

    await wrapper.find(".open").trigger("click");
    const modal = document.querySelector<HTMLElement>("#m1.modal.is-active");
    expect(modal).not.toBeNull();
    expect(modal!.querySelector(".modal-card-body")!.textContent).toBe("body text");
    expect(wrapper.emitted("update:modelValue")).toEqual([[true]]);
    wrapper.unmount();
  });

  it("closes from the background and from the header button", async () => {
    const wrapper = mountModal({ modelValue: true }, { header: "title" });
    await nextTick();
    document.querySelector<HTMLElement>(".modal-background")!.click();
    await nextTick();
    expect(document.querySelector(".modal")).toBeNull();

    await wrapper.find(".open").trigger("click");
    document.querySelector<HTMLElement>("button.delete")!.click();
    await nextTick();
    expect(document.querySelector(".modal")).toBeNull();
    expect(wrapper.emitted("update:modelValue")).toEqual([[false], [true], [false]]);
    wrapper.unmount();
  });

  it("follows v-model from the parent", async () => {
    const wrapper = mountModal({ modelValue: false });
    await wrapper.setProps({ modelValue: true });
    expect(document.querySelector(".modal.is-active")).not.toBeNull();
    await wrapper.setProps({ modelValue: false });
    expect(document.querySelector(".modal")).toBeNull();
    // The parent made the change, so nothing is reported back.
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    wrapper.unmount();
  });

  it("applies size defaults, given sizes and a style object", async () => {
    const wrapper = mountModal({ modelValue: true });
    await nextTick();
    let card = document.querySelector<HTMLElement>(".modal-card")!;
    expect(card.style.width).toBe("80%");
    expect(card.style.height).toBe("unset");
    wrapper.unmount();
    document.body.innerHTML = "";

    const sized = mountModal({
      modelValue: true,
      width: "500px",
      height: "300px",
      styles: { zIndex: "999" },
    });
    await nextTick();
    card = document.querySelector<HTMLElement>(".modal-card")!;
    expect(card.style.width).toBe("500px");
    expect(card.style.height).toBe("300px");
    expect(document.querySelector<HTMLElement>(".modal")!.style.zIndex).toBe("999");
    sized.unmount();
  });

  it("omits header, body and footer when their slots are not given", async () => {
    const wrapper = mount(Modal, {
      props: { modelValue: true },
      slots: { footer: "<span class='f'>foot</span>" },
      attachTo: document.body,
      global,
    });
    await nextTick();
    expect(document.querySelector(".modal-card-head")).toBeNull();
    expect(document.querySelector(".modal-card-body")).toBeNull();
    expect(document.querySelector(".modal-card-foot .f")).not.toBeNull();
    wrapper.unmount();
  });

  it("hands open and close to the slots and to descendants", async () => {
    const Child = defineComponent({
      setup() {
        const closeModal = inject<() => void>("closeModal");
        const openModal = inject<() => void>("openModal");
        return () =>
          h("div", [
            h("button", { class: "injected-close", onClick: closeModal }),
            h("button", { class: "injected-open", onClick: openModal }),
          ]);
      },
    });
    const wrapper = mount(Modal, {
      slots: {
        render: `<template #render="{ open }"><a class="render-open" @click="open">x</a></template>`,
        content: `<template #content="{ closeModal }"><a class="slot-close" @click="closeModal">x</a><Child /></template>`,
      },
      attachTo: document.body,
      global: { ...global, components: { Child } },
    });

    await wrapper.find(".render-open").trigger("click");
    expect(document.querySelector(".modal")).not.toBeNull();
    document.querySelector<HTMLElement>(".slot-close")!.click();
    await nextTick();
    expect(document.querySelector(".modal")).toBeNull();

    await wrapper.find(".render-open").trigger("click");
    document.querySelector<HTMLElement>(".injected-close")!.click();
    await nextTick();
    expect(document.querySelector(".modal")).toBeNull();
    expect(wrapper.emitted("update:modelValue")).toEqual([[true], [false], [true], [false]]);
    wrapper.unmount();
  });
});

describe("CustomConfirm", () => {
  const mountConfirm = (props = {}) =>
    mount(CustomConfirm, {
      props,
      slots: {
        render: `<template #render="{ confirm }"><a class="ask" @click="confirm">ask</a></template>`,
      },
      attachTo: document.body,
      global,
    });

  it("asks, and passes a function that closes the dialog with the answer", async () => {
    const wrapper = mountConfirm();
    expect(document.querySelector(".modal")).toBeNull();
    await wrapper.find(".ask").trigger("click");
    expect(document.querySelector(".modal-card-body")!.textContent).toContain("Are you sure");

    const buttons = document.querySelectorAll<HTMLElement>(".modal-card-foot button");
    expect(buttons).toHaveLength(2);
    buttons[1].click();
    await nextTick();
    const [closeModal] = wrapper.emitted("confirm")![0] as [() => void];
    // Answering does not close by itself: the caller decides when.
    expect(document.querySelector(".modal")).not.toBeNull();
    closeModal();
    await nextTick();
    expect(document.querySelector(".modal")).toBeNull();
    wrapper.unmount();
  });

  it("closes on No without confirming", async () => {
    const wrapper = mountConfirm();
    await wrapper.find(".ask").trigger("click");
    document.querySelector<HTMLElement>(".modal-card-foot button")!.click();
    await nextTick();
    expect(document.querySelector(".modal")).toBeNull();
    expect(wrapper.emitted("confirm")).toBeUndefined();
    wrapper.unmount();
  });

  it("shows only Yes when asked to, and the busy state", async () => {
    const wrapper = mountConfirm({ onlyYes: true, loading: true });
    await wrapper.find(".ask").trigger("click");
    const buttons = document.querySelectorAll<HTMLElement>(".modal-card-foot button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].classList.contains("is-loading")).toBe(true);
    wrapper.unmount();
  });
});

describe("Asset", () => {
  it("picks the element from the type, given as object or as string", () => {
    const audio = mount(Asset, {
      props: { asset: { assetType: { name: "audio" }, src: "/a.mp3" } },
    });
    expect(audio.find("audio").attributes("src")).toContain("/a.mp3");

    const video = mount(Asset, {
      props: { asset: { assetType: "video", fileLocation: "/v.mp4" } },
    });
    expect(video.find("video").attributes("src")).toContain("/v.mp4");

    const image = mount(Asset, {
      props: { asset: { assetType: { name: "avatar" }, src: "/i.png" } },
    });
    expect(image.find("img").attributes("src")).toContain("/i.png");
  });

  it("prefers inline data and leaves the asset it was given unchanged", () => {
    const asset = {
      assetType: { name: "avatar" },
      src: "/i.png",
      base64: "data:image/png;base64,AA",
    };
    const wrapper = mount(Asset, { props: { asset } });
    expect(wrapper.find("img").attributes("src")).toBe("data:image/png;base64,AA");
    expect(asset.assetType).toEqual({ name: "avatar" });
  });

  it("reports the image size once loaded", async () => {
    const wrapper = mount(Asset, { props: { asset: { assetType: "avatar", src: "/i.png" } } });
    const img = wrapper.find("img");
    (img.element as HTMLImageElement).width = 120;
    (img.element as HTMLImageElement).height = 80;
    await img.trigger("load");
    expect(wrapper.emitted("detectSize")).toEqual([[{ width: 120, height: 80 }]]);
  });
});

describe("Icon", () => {
  const style = (props: Record<string, unknown>) =>
    (mount(Icon, { props: props as { src: string } }).element as HTMLElement).style;

  it("is 16px square unless told otherwise", () => {
    const wrapper = mount(Icon, { props: { src: "save.svg" } });
    expect(wrapper.attributes("src")).toBe("/icons/save.svg");
    expect(style({ src: "a.svg" }).width).toBe("16px");
    expect(style({ src: "a.svg" }).height).toBe("16px");
  });

  it("takes numbers or strings, width and height over size", () => {
    expect(style({ src: "a.svg", size: "24" }).width).toBe("24px");
    const mixed = style({ src: "a.svg", size: 24, width: 40 });
    expect(mixed.width).toBe("40px");
    expect(mixed.height).toBe("24px");
  });
});

describe("Selectable", () => {
  const icon = (props = {}) =>
    mount(Selectable, { props, slots: { default: "item" }, global })
      .find(".overlay i")
      .classes();

  it("reports a click and shows the state", async () => {
    const wrapper = mount(Selectable, { props: { selected: true }, slots: { default: "item" } });
    expect(wrapper.classes()).toContain("selected");
    await wrapper.trigger("click");
    expect(wrapper.emitted("select")).toHaveLength(1);
  });

  it("shows plus only for an unselected item of a multiple choice", () => {
    expect(icon()).toContain("fa-check");
    expect(icon({ multiple: true })).toContain("fa-plus");
    expect(icon({ multiple: true, selected: true })).toContain("fa-check");
    expect(icon({ revert: true })).toContain("fa-minus");
  });
});
