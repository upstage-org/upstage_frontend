// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import en from "../../../i18n/en";

/**
 * A configuration entry's tip (#1568): a short text beside an on/off switch
 * saying what it does — "Expose or hide the Registration button." for the
 * Registration toggle on the Foyer Customisation page.
 */

vi.mock("hooks/mutations", async () => {
  const { ref } = await import("vue");
  return { useLoading: () => ({ loading: ref(false), proceed: vi.fn(async () => ({})) }) };
});
vi.mock("components/editor/RichTextEditor.vue", () => ({ default: { template: "<div />" } }));
vi.mock("services/graphql", () => ({ configGraph: { saveConfig: vi.fn() } }));

import Entry from "./entry.vue";

const stubs = {
  "a-form-item": { template: "<div class='form-item'><slot /></div>" },
  "a-switch": { template: "<button class='switch' />" },
  "a-input-group": { template: "<div><slot /></div>" },
  "a-input": { template: "<input />" },
  "a-textarea": { template: "<textarea />" },
  "a-button": { template: "<button><slot /></button>" },
};
const mountEntry = (props: { defaultValue: string | boolean; [key: string]: unknown }) =>
  mount(Entry, {
    props: { name: "SHOW_REGISTRATION", label: "Registration Button", ...props },
    global: { stubs },
  });
const tip = (w: ReturnType<typeof mountEntry>) => w.find('[data-testid="entry-tip"]');

describe("configuration entry tip", () => {
  it("is shown right after the switch of an on/off entry", () => {
    const w = mountEntry({ defaultValue: false, tip: en.registration_button_tip });
    expect(tip(w).text()).toBe("Expose or hide the Registration button.");
    const children = [...w.find(".form-item").element.children];
    const switchIndex = children.findIndex((el) => el.classList.contains("switch"));
    expect(switchIndex).toBeGreaterThanOrEqual(0);
    expect(children[switchIndex + 1]).toBe(tip(w).element);
  });

  it("is shown whether the switch is on or off", () => {
    expect(tip(mountEntry({ defaultValue: true, tip: "what it does" })).text()).toBe(
      "what it does",
    );
  });

  it("an on/off entry without a tip has none", () => {
    const w = mountEntry({ defaultValue: false });
    expect(tip(w).exists()).toBe(false);
    expect(w.find(".switch").exists()).toBe(true);
  });

  it("a text entry never shows it", () => {
    const w = mountEntry({ name: "FOYER_TITLE", label: "Title", defaultValue: "Hello", tip: "x" });
    expect(tip(w).exists()).toBe(false);
    expect(w.find(".switch").exists()).toBe(false);
  });

  it("the English wording is what was asked for", () => {
    expect(en.registration_button_tip).toBe("Expose or hide the Registration button.");
  });
});
