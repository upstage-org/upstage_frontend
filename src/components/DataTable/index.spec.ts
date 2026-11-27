// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

const useQuery = vi.hoisted(() => vi.fn());
vi.mock("services/graphql/composable", () => ({ useQuery }));

import DataTable from "./index.vue";

/**
 * Contract of DataTable as Stage Management > Archive relies on it: rows from
 * `data` (or from `query`), header render/key/slot cells, sorting, paging.
 */
const global = {
  stubs: {
    "a-tooltip": { template: "<span><slot /></span>" },
    Pagination: true,
    Loading: { template: "<div class='loading-stub' />" },
  },
};

const headers = [
  { title: "Name", key: "name", sortable: true },
  { title: "Size", render: (item: { size: number }) => `${item.size} kB` },
  { title: "Actions", slot: "actions" },
];
const data = () => [
  { name: "charlie", size: 3 },
  { name: "alpha", size: 1 },
  { name: "bravo", size: 2 },
];

const mountTable = (props: Record<string, unknown>, slots = {}) =>
  mount(DataTable, { props, slots, global });
const column = (wrapper: ReturnType<typeof mountTable>, index: number) =>
  wrapper.findAll("tbody tr").map((tr) => tr.findAll("td")[index].text());

beforeEach(() => {
  useQuery.mockReset();
});

describe("DataTable", () => {
  it("renders numbered rows with key, render and slot cells, without querying", () => {
    const wrapper = mountTable(
      { data: data(), headers },
      { actions: `<template #actions="{ item }">edit {{ item.name }}</template>` },
    );
    expect(useQuery).not.toHaveBeenCalled();
    expect(wrapper.find(".loading-stub").exists()).toBe(false);
    expect(column(wrapper, 0)).toEqual(["1", "2", "3"]);
    expect(column(wrapper, 1)).toEqual(["charlie", "alpha", "bravo"]);
    expect(column(wrapper, 2)).toEqual(["3 kB", "1 kB", "2 kB"]);
    expect(column(wrapper, 3)).toEqual(["edit charlie", "edit alpha", "edit bravo"]);
    expect(wrapper.find("tfoot").exists()).toBe(false);
  });

  it("shows the empty message across all columns", () => {
    const numbered = mountTable({ data: [], headers });
    expect(numbered.find("tfoot td").attributes("colspan")).toBe("4");
    const plain = mountTable({ data: [], headers, numbered: false });
    expect(plain.find("tfoot td").attributes("colspan")).toBe("3");
    expect(plain.findAll("thead th")).toHaveLength(3);
  });

  it("sorts by a sortable header and flips the order on the second click", async () => {
    const wrapper = mountTable({ data: data(), headers });
    const name = wrapper.findAll("thead th")[1];
    await name.trigger("click");
    expect(column(wrapper, 1)).toEqual(["alpha", "bravo", "charlie"]);
    await name.trigger("click");
    expect(column(wrapper, 1)).toEqual(["charlie", "bravo", "alpha"]);
    // Not sortable: nothing changes.
    await wrapper.findAll("thead th")[2].trigger("click");
    expect(column(wrapper, 1)).toEqual(["charlie", "bravo", "alpha"]);
  });

  it("applies a header's default sort order after mount", async () => {
    const wrapper = mountTable({
      data: data(),
      headers: [{ title: "Name", key: "name", sortable: true, defaultSortOrder: false }],
    });
    await wrapper.vm.$nextTick();
    expect(column(wrapper, 1)).toEqual(["charlie", "bravo", "alpha"]);
  });

  it("sorts a date column by time, not as text", async () => {
    const wrapper = mountTable({
      data: [
        { name: "new", createdOn: "2026-09-02T10:00:00" },
        { name: "old", createdOn: "2025-12-31T10:00:00" },
        // Same instant as a Date object and as a timestamp would sort wrongly as text.
        { name: "middle", createdOn: new Date("2026-01-15T10:00:00") },
      ],
      headers: [
        { title: "Name", key: "name" },
        { title: "Archived On", key: "createdOn", type: "date", sortable: true },
      ],
    });
    const archivedOn = wrapper.findAll("thead th")[2];
    await archivedOn.trigger("click");
    expect(column(wrapper, 1)).toEqual(["old", "middle", "new"]);
    await archivedOn.trigger("click");
    expect(column(wrapper, 1)).toEqual(["new", "middle", "old"]);
  });

  it("shows ten rows per page", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ name: `n${i}`, size: i }));
    expect(mountTable({ data: rows, headers }).findAll("tbody tr")).toHaveLength(10);
  });

  it("uses the query when no data is given and waits while it loads", async () => {
    const loading = ref(true);
    const nodes = ref<unknown[]>([]);
    const query = vi.fn();
    useQuery.mockReturnValue({ nodes, loading, totalCount: ref(0), refresh: vi.fn() });
    const wrapper = mountTable({ query, headers });
    expect(useQuery).toHaveBeenCalledWith(query);
    expect(wrapper.find(".loading-stub").exists()).toBe(true);
    expect(wrapper.find("table").exists()).toBe(false);

    nodes.value = data();
    loading.value = false;
    await wrapper.vm.$nextTick();
    expect(column(wrapper, 1)).toEqual(["charlie", "alpha", "bravo"]);
  });
});
