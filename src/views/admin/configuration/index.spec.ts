// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";

/**
 * Every configuration entry must reload the shared configuration store after
 * a save (#1575). The e-mail signature entry (and four others) had no
 * refresh hook: the value was saved on the server, but the store — which the
 * e-mail page appends the signature from, and which this page shows again
 * when revisited — kept the old value until the browser was reloaded. A logo
 * added to the signature "disappeared" and never reached an e-mail.
 */

const seen = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  fetchConfig: null as unknown,
}));

vi.mock("./entry.vue", () => ({
  default: defineComponent({
    name: "EntryStub",
    inheritAttrs: false,
    props: [
      "name",
      "label",
      "defaultValue",
      "refresh",
      "richTextEditor",
      "multiline",
      "help",
      "tip",
    ],
    setup(props) {
      seen.entries.push(props as unknown as Record<string, unknown>);
      return () => h("div", { class: "entry", "data-name": props.name });
    },
  }),
}));
vi.mock("./PinnedStages.vue", () => ({
  default: defineComponent({
    render: () => h("div", { class: "entry", "data-name": "FOYER_PINNED_STAGES" }),
  }),
}));
vi.mock("components/Header.vue", () => ({ default: defineComponent({ render: () => h("div") }) }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("vue-router", () => ({ useRoute: () => ({ query: { tab: "system" } }) }));
vi.mock("@stores/pinia/config", () => {
  const fetchConfig = vi.fn(async () => {});
  seen.fetchConfig = fetchConfig;
  const state = reactive({
    foyer: { title: { value: "t" }, description: { value: "d" }, menu: { value: "m" } },
    system: {
      termsOfService: { value: "tos" },
      manual: { value: "man" },
      esp: { value: "esp" },
      emailSignature: { value: "<p>sig</p>" },
      enableDonate: { value: false },
    },
    fetchConfig,
  });
  return { useConfigStore: () => state };
});
vi.mock("pinia", async (importOriginal) => {
  const { toRef } = await import("vue");
  return {
    ...(await importOriginal<typeof import("pinia")>()),
    storeToRefs: (s: Record<string, unknown>) => ({
      foyer: toRef(s, "foyer"),
      system: toRef(s, "system"),
    }),
  };
});

import Configuration from "./index.vue";

const stubs = {
  "a-layout": { template: "<div><slot /></div>" },
  "a-tabs": { template: "<div><slot /></div>" },
  "a-tab-pane": { template: "<div><slot /></div>" },
  "a-form": { template: "<div><slot /></div>" },
  Space: { template: "<div><slot /></div>" },
  Skeleton: true,
};

describe("configuration entries refresh the shared store after saving (#1575)", () => {
  it("gives every entry a refresh hook that reloads the configuration", async () => {
    seen.entries.length = 0;
    mount(Configuration, { global: { stubs, mocks: { $t: (k: string) => k } } });
    const names = seen.entries.map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "FOYER_TITLE",
        "FOYER_DESCRIPTION",
        "FOYER_MENU",
        "TERMS_OF_SERVICE",
        "MANUAL",
        "EMAIL_SUBJECT_PREFIX",
        "EMAIL_SIGNATURE",
      ]),
    );
    for (const entry of seen.entries) {
      expect(typeof entry.refresh, `${String(entry.name)} has a refresh hook`).toBe("function");
    }
    const fetchConfig = seen.fetchConfig as ReturnType<typeof vi.fn>;
    fetchConfig.mockClear();
    const signature = seen.entries.find((e) => e.name === "EMAIL_SIGNATURE")!;
    await (signature.refresh as () => Promise<void>)();
    expect(fetchConfig).toHaveBeenCalledTimes(1);
  });
});

/**
 * #1568 (Helen, 2026-11-25): the Foyer Customisation fields in the order
 * they are used — pinned stages right after the title and description, the
 * rarely edited menu last — and a tip beside the Registration toggle.
 */
describe("Foyer Customisation layout (#1568)", () => {
  const mountPage = () => {
    seen.entries.length = 0;
    return mount(Configuration, { global: { stubs, mocks: { $t: (k: string) => k } } });
  };
  const FOYER = [
    "FOYER_TITLE",
    "FOYER_DESCRIPTION",
    "FOYER_PINNED_STAGES",
    "SHOW_REGISTRATION",
    "ENABLE_DONATE",
    "FOYER_MENU",
  ];

  it("lists the fields as: title, description, pinned stages, registration, donate, menu", () => {
    const names = mountPage()
      .findAll(".entry")
      .map((e) => e.attributes("data-name"));
    expect(names.slice(0, FOYER.length)).toEqual(FOYER);
    // The system tab's own order is untouched.
    expect(names.slice(FOYER.length)).toEqual([
      "TERMS_OF_SERVICE",
      "MANUAL",
      "EMAIL_SUBJECT_PREFIX",
      "EMAIL_SIGNATURE",
    ]);
  });

  it("puts the menu last and the pinned stages before both toggles", () => {
    const names = mountPage()
      .findAll(".entry")
      .map((e) => e.attributes("data-name"))
      .slice(0, FOYER.length);
    expect(names.at(-1)).toBe("FOYER_MENU");
    expect(names.indexOf("FOYER_PINNED_STAGES")).toBeLessThan(names.indexOf("SHOW_REGISTRATION"));
    expect(names.indexOf("FOYER_DESCRIPTION")).toBeLessThan(names.indexOf("FOYER_PINNED_STAGES"));
  });

  it("gives the Registration toggle its tip, and only that entry", () => {
    mountPage();
    const registration = seen.entries.find((e) => e.name === "SHOW_REGISTRATION")!;
    expect(registration.tip).toBe("registration_button_tip");
    expect(registration.label).toBe("registration_button");
    for (const entry of seen.entries) {
      if (entry.name !== "SHOW_REGISTRATION") expect(entry.tip, String(entry.name)).toBeUndefined();
    }
  });

  it("keeps each field's settings through the move (menu syntax help, rich text, defaults)", () => {
    mountPage();
    const by = (name: string) => seen.entries.find((e) => e.name === name)!;
    expect(by("FOYER_MENU").multiline).toBe(true);
    expect(by("FOYER_MENU").help).toBeTruthy();
    expect(by("FOYER_MENU").defaultValue).toBe("m");
    expect(by("FOYER_DESCRIPTION").richTextEditor).toBe(true);
    expect(by("FOYER_TITLE").defaultValue).toBe("t");
    expect(by("SHOW_REGISTRATION").defaultValue).toBe(false);
    expect(by("ENABLE_DONATE").defaultValue).toBe(false);
  });
});
