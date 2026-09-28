// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import MultiTransferAccessColumn from "./MultiTransferAccessColumn.vue";

/**
 * Stage Management > General: players move between "audience only", "player"
 * and "player and edit" columns; v-model holds [[player ids], [editor ids]].
 */
const users = [
  { id: 1, name: "Abram" },
  { id: 2, name: "Balthasar" },
  { id: 3, name: "Capulet" },
];

const mountColumns = (modelValue: number[][] = [[2], [3]]) =>
  mount(MultiTransferAccessColumn, {
    props: {
      modelValue,
      columns: ["Audience", "Player", "Editor"],
      data: users,
      owner: { id: 9, name: "Owner" },
      renderLabel: (item: { name: string }) => item.name,
      renderValue: (item: { id: number }) => item.id,
    },
  });

type Wrapper = ReturnType<typeof mountColumns>;
const names = (wrapper: Wrapper) =>
  wrapper
    .findAll("article.panel")
    .map((panel) => panel.findAll("a.panel-block:not(.owner)").map((a) => a.text()));
const row = (wrapper: Wrapper, name: string) =>
  wrapper.findAll("a.panel-block:not(.owner)").find((a) => a.text() === name)!;
const lastValue = (wrapper: Wrapper) => wrapper.emitted("update:modelValue")!.at(-1)![0];

describe("MultiTransferAccessColumn", () => {
  it("places everyone by the model and counts the owner in the last column", () => {
    const wrapper = mountColumns();
    expect(names(wrapper)).toEqual([["Abram"], ["Balthasar"], ["Capulet"]]);
    expect(wrapper.findAll(".panel-heading .tag").map((tag) => tag.text())).toEqual([
      "1",
      "1",
      "2",
    ]);
    const owner = wrapper.findAll("article.panel")[2].find(".owner");
    expect(owner.text()).toContain("Owner");
  });

  it("moves right on click, and left from the last column", async () => {
    const wrapper = mountColumns();
    await row(wrapper, "Abram").trigger("click");
    expect(names(wrapper)).toEqual([[], ["Abram", "Balthasar"], ["Capulet"]]);
    expect(lastValue(wrapper)).toEqual([[1, 2], [3]]);

    await row(wrapper, "Capulet").trigger("click");
    expect(lastValue(wrapper)).toEqual([[1, 2, 3], []]);
  });

  it("moves left on right-click, except in the first column", async () => {
    const wrapper = mountColumns();
    await row(wrapper, "Balthasar").trigger("contextmenu");
    expect(lastValue(wrapper)).toEqual([[], [3]]);

    const before = wrapper.emitted("update:modelValue")!.length;
    await row(wrapper, "Abram").trigger("contextmenu");
    expect(wrapper.emitted("update:modelValue")).toHaveLength(before);
  });

  it("filters a column by its search box and moves only the matches", async () => {
    const wrapper = mountColumns([[], []]);
    await wrapper.findAll("input")[0].setValue("BAL");
    expect(names(wrapper)[0]).toEqual(["Balthasar"]);

    await wrapper.find("button[title='Move all matching right']").trigger("click");
    expect(lastValue(wrapper)).toEqual([[2], []]);

    await wrapper.findAll("input")[0].setValue("");
    expect(names(wrapper)).toEqual([["Abram", "Capulet"], ["Balthasar"], []]);
  });
});
