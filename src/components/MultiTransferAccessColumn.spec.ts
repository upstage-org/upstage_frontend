// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import MultiTransferAccessColumn from "./MultiTransferAccessColumn.vue";

/**
 * Stage Management → Player access (#1577).
 *
 * The "move everyone" controls between the columns are solid green
 * double-chevron buttons at the top of the gap, as shown in the user manual.
 * A styling pass once replaced them with small bare single chevrons centred
 * halfway down the lists, where they no longer read as controls. These tests
 * pin the look (as far as markup can) and the behaviour.
 */
const columns = ["Audience access only", "Player access", "Player and edit access"];
const users = ["ada", "bea", "cy"];

function mountColumns(modelValue: string[][] = [[], []]) {
  return mount(MultiTransferAccessColumn, {
    props: { columns, data: users, modelValue },
  });
}

describe("MultiTransferAccessColumn — move-all buttons", () => {
  it("renders a right and a left button in each gap between columns", () => {
    const w = mountColumns();
    expect(w.findAll('[data-testid="transfer-all-right"]')).toHaveLength(columns.length - 1);
    expect(w.findAll('[data-testid="transfer-all-left"]')).toHaveLength(columns.length - 1);
  });

  it("uses the solid primary button style with double-chevron icons", () => {
    const w = mountColumns();
    for (const b of w.findAll('[data-testid^="transfer-all-"]')) {
      expect(b.classes()).toEqual(expect.arrayContaining(["button", "is-primary", "is-small"]));
      expect(b.attributes("type")).toBe("button");
    }
    expect(w.find('[data-testid="transfer-all-right"] i').classes()).toEqual(
      expect.arrayContaining(["fas", "fa-angle-double-right"]),
    );
    expect(w.find('[data-testid="transfer-all-left"] i').classes()).toEqual(
      expect.arrayContaining(["fas", "fa-angle-double-left"]),
    );
  });

  it("keeps the buttons at the top of the gap (not vertically centred) and stacked", () => {
    const w = mountColumns();
    const gap = w.find('[data-testid="transfer-all-right"]').element.parentElement!;
    expect(gap.classList.contains("column")).toBe(true);
    expect(gap.classList.contains("is-narrow")).toBe(true);
    expect(gap.classList.contains("is-align-self-center")).toBe(false);
    expect(gap.classList.contains("is-flex")).toBe(false);
    // right button, line breaks, left button — in that order
    const kinds = Array.from(gap.children).map(
      (el) => el.getAttribute("data-testid") ?? el.tagName.toLowerCase(),
    );
    expect(kinds).toEqual(["transfer-all-right", "br", "br", "transfer-all-left"]);
  });

  it("the old small-arrow markup is gone", () => {
    const html = mountColumns().html();
    expect(html).not.toContain("upstage-multi-transfer");
    expect(html).not.toContain("anticon");
  });

  it("moves everyone one column right, then back left", async () => {
    const w = mountColumns();
    await w.findAll('[data-testid="transfer-all-right"]')[0].trigger("click");
    await nextTick();
    expect(w.emitted("update:modelValue")!.at(-1)![0]).toEqual([users, []]);

    await w.findAll('[data-testid="transfer-all-right"]')[1].trigger("click");
    await nextTick();
    expect(w.emitted("update:modelValue")!.at(-1)![0]).toEqual([[], users]);

    await w.findAll('[data-testid="transfer-all-left"]')[1].trigger("click");
    await w.findAll('[data-testid="transfer-all-left"]')[0].trigger("click");
    await nextTick();
    expect(w.emitted("update:modelValue")!.at(-1)![0]).toEqual([[], []]);
  });

  it("moves only the names matching that column's search", async () => {
    const w = mountColumns();
    await w.findAll("input")[0].setValue("b");
    await w.findAll('[data-testid="transfer-all-right"]')[0].trigger("click");
    await nextTick();
    expect(w.emitted("update:modelValue")!.at(-1)![0]).toEqual([["bea"], []]);
  });
});
