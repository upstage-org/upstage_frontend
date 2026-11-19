// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * #1570: the owner's permission note (credits, conditions) has to reach the
 * players who use the item. The pop-up showed it only for "Use with
 * acknowledgement" items, so a granted "Use with permission" item — and a
 * "Copyright free" credit line — were shown without it.
 */

vi.mock("@vue/apollo-composable", async () => {
  const { ref } = await import("vue");
  return {
    useQuery: () => ({
      result: ref({ whoami: { username: "p" }, stages: { edges: [] } }),
      loading: ref(false),
    }),
    useMutation: () => ({ mutate: vi.fn() }),
  };
});
vi.mock("@stores/pinia/user", async () => {
  const { ref } = await import("vue");
  return { useUserStore: () => ({ isAdmin: ref(false) }) };
});
vi.mock("pinia", async (importOriginal) => ({
  ...(await importOriginal<typeof import("pinia")>()),
  storeToRefs: (s: object) => s,
}));

import QuickStageAssignment from "./QuickStageAssignment.vue";

const media = (copyrightLevel: number, note?: string) => ({
  id: "1",
  name: "Julius",
  copyrightLevel,
  description: JSON.stringify(note === undefined ? {} : { note }),
  owner: { username: "gloria", displayName: "Gloria" },
  stages: [],
  assetType: null,
});

const stubs = {
  "a-button": { template: "<button @click=\"$emit('click')\"><slot /></button>" },
  "a-modal": { template: "<div class='modal'><slot /></div>" },
  "a-select": { template: "<select />" },
  "plus-circle-outlined": true,
  DName: { props: ["user"], template: "<span>{{ user.displayName }}</span>" },
  MediaPreview: true,
};

const open = async (m: ReturnType<typeof media>) => {
  const wrapper = mount(QuickStageAssignment, { props: { media: m as never }, global: { stubs } });
  await wrapper.find("button").trigger("click");
  await nextTick();
  return wrapper;
};

describe("QuickStageAssignment owner note", () => {
  it.each([0, 1, 2])("shows the owner's note on a level %i item", async (level) => {
    const wrapper = await open(media(level, "Please credit Gloria's sister."));
    const note = wrapper.find("[data-testid=owner-note]");
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain("Note from Gloria");
    expect(note.text()).toContain("Please credit Gloria's sister.");
  });

  it("shows nothing when there is no note", async () => {
    const wrapper = await open(media(1));
    expect(wrapper.find("[data-testid=owner-note]").exists()).toBe(false);
    const blank = await open(media(2, "   "));
    expect(blank.find("[data-testid=owner-note]").exists()).toBe(false);
  });
});
