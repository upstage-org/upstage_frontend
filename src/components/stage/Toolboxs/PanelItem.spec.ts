// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import PanelItem from "./PanelItem.vue";

/**
 * Toolbox button: highlighted while its tool is the open one. `tool` is
 * provided as a ref by Toolboxs/index.vue and must stay reactive here.
 */
const mountItem = (tool = ref<string | undefined>()) => {
  const changeTool = vi.fn((name?: string) => {
    tool.value = tool.value === name ? undefined : name;
  });
  const wrapper = mount(PanelItem, {
    props: { name: "Avatars", icon: "avatar.svg" },
    global: {
      provide: { tool, changeTool },
      stubs: {
        "a-tooltip": { template: "<span><slot /></span>" },
        Icon: { props: ["src"], template: "<i class='icon-stub' :data-src='src' />" },
      },
    },
  });
  return { wrapper, tool, changeTool };
};

describe("PanelItem", () => {
  it("is highlighted only while its own tool is open", async () => {
    const { wrapper, tool } = mountItem();
    expect(wrapper.find("a").classes()).not.toContain("is-active");

    tool.value = "Avatars";
    await nextTick();
    expect(wrapper.find("a").classes()).toContain("is-active");

    tool.value = "Props";
    await nextTick();
    expect(wrapper.find("a").classes()).not.toContain("is-active");
  });

  it("starts highlighted when its tool is already open", () => {
    const { wrapper } = mountItem(ref<string | undefined>("Avatars"));
    expect(wrapper.find("a").classes()).toContain("is-active");
  });

  it("changes the tool and reports the click", async () => {
    const { wrapper, changeTool } = mountItem();
    await wrapper.find("a").trigger("click");
    expect(changeTool).toHaveBeenCalledWith("Avatars");
    expect(wrapper.emitted("click")).toHaveLength(1);
    expect(wrapper.find("a").classes()).toContain("is-active");
    expect(wrapper.find(".icon-stub").attributes("data-src")).toBe("avatar.svg");
  });
});
