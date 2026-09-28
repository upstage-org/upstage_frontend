// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import Pagination from "./Pagination.vue";

const mountPagination = (props: { total?: number; modelValue: number; limit: number }) =>
  mount(Pagination, { props, global: { stubs: { Dropdown: true } } });

const pages = (wrapper: ReturnType<typeof mountPagination>) =>
  wrapper
    .findAll(".pagination-list li")
    .map((li) => (li.find(".pagination-ellipsis").exists() ? "…" : li.text()));

describe("Pagination", () => {
  it("shows a single page when there is nothing to page through", () => {
    expect(pages(mountPagination({ modelValue: 1, limit: 10 }))).toEqual(["1"]);
    expect(pages(mountPagination({ total: 10, modelValue: 1, limit: 10 }))).toEqual(["1"]);
  });

  it("lists every page while they fit", () => {
    const wrapper = mountPagination({ total: 70, modelValue: 3, limit: 10 });
    expect(pages(wrapper)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(wrapper.find(".is-current").text()).toBe("3");
  });

  it("keeps first and last and abbreviates the rest around the current page", () => {
    expect(pages(mountPagination({ total: 200, modelValue: 1, limit: 10 }))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "…",
      "20",
    ]);
    expect(pages(mountPagination({ total: 200, modelValue: 10, limit: 10 }))).toEqual([
      "1",
      "…",
      "8",
      "9",
      "10",
      "11",
      "12",
      "…",
      "20",
    ]);
    expect(pages(mountPagination({ total: 200, modelValue: 20, limit: 10 }))).toEqual([
      "1",
      "…",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20",
    ]);
  });

  it("disables the step buttons at the ends", () => {
    const first = mountPagination({ total: 30, modelValue: 1, limit: 10 });
    expect(first.find(".pagination-previous").attributes("disabled")).toBeDefined();
    expect(first.find(".pagination-next").attributes("disabled")).toBeUndefined();

    const last = mountPagination({ total: 30, modelValue: 3, limit: 10 });
    expect(last.find(".pagination-previous").attributes("disabled")).toBeUndefined();
    expect(last.find(".pagination-next").attributes("disabled")).toBeDefined();
  });

  it("reports the page asked for, then that something changed", async () => {
    const wrapper = mountPagination({ total: 50, modelValue: 2, limit: 10 });
    await wrapper.find(".pagination-next").trigger("click");
    await wrapper.find(".pagination-previous").trigger("click");
    await wrapper.findAll(".pagination-link")[4].trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([[3], [1], [5]]);
    expect(wrapper.emitted("change")).toHaveLength(3);
  });

  it("goes back to the first page when the page size changes", async () => {
    const wrapper = mountPagination({ total: 50, modelValue: 4, limit: 10 });
    await wrapper.findComponent({ name: "Dropdown" }).vm.$emit("update:modelValue", 25);
    expect(wrapper.emitted("update:modelValue")).toEqual([[1]]);
    expect(wrapper.emitted("update:limit")).toEqual([[25]]);
    expect(wrapper.emitted("change")).toHaveLength(1);
  });
});
