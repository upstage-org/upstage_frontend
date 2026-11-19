// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * #1570: the owner's permission note (credits, conditions) has to reach the
 * players who use the item. The pop-up showed it only for "Use with
 * acknowledgement" items, so a granted "Use with permission" item — and a
 * "Copyright free" credit line — were shown without it.
 */

const { mutate, toast } = vi.hoisted(() => ({
  mutate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@vue/apollo-composable", async () => {
  const { ref } = await import("vue");
  return {
    useQuery: () => ({
      result: ref({
        whoami: { username: "p" },
        stages: {
          edges: [
            { id: "7", name: "Mine", permission: "owner" },
            { id: "8", name: "Theirs (player access)", permission: "player" },
          ],
        },
      }),
      loading: ref(false),
    }),
    useMutation: () => ({ mutate }),
  };
});
vi.mock("ant-design-vue", () => ({ message: toast }));
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
  stages: [] as { id: string; name: string }[],
  assetType: null,
});

const stubs = {
  "a-button": { template: "<button @click=\"$emit('click')\"><slot /></button>" },
  "a-modal": { props: ["visible"], template: "<div v-if='visible' class='modal'><slot /></div>" },
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

beforeEach(() => {
  mutate.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("QuickStageAssignment saving (#1569)", () => {
  it("closes and reports success when the assignment is accepted", async () => {
    mutate.mockResolvedValue({ data: { quickAssignMutation: { success: true } } });
    const wrapper = await open(media(0));
    await wrapper.find("[data-testid=save]").trigger("click");
    await flushPromises();
    // Only the item's CURRENT assignments on unmanageable stages are kept;
    // stage 8 (player access, item not there) must not be sent (#1569).
    expect(mutate).toHaveBeenCalledWith({ assetId: "1", stageIds: [] });
    expect(toast.success).toHaveBeenCalled();
    expect(wrapper.find(".modal").exists()).toBe(false);
  });

  it("stays open and shows the server's reason when the assignment is refused", async () => {
    mutate.mockRejectedValue(new Error("You are not allowed to assign this media"));
    const wrapper = await open(media(2));
    await wrapper.find("[data-testid=save]").trigger("click");
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith("You are not allowed to assign this media");
    expect(toast.success).not.toHaveBeenCalled();
    expect(wrapper.find(".modal").exists()).toBe(true);
  });
});

describe("QuickStageAssignment keeps unmanageable assignments (#1569)", () => {
  it("sends the item's current assignment on a stage the user cannot manage, not every such stage", async () => {
    mutate.mockResolvedValue({ data: { quickAssignMutation: { success: true } } });
    const m = {
      ...media(0),
      stages: [
        { id: "9", name: "Owner's stage" },
        { id: "7", name: "Mine" },
      ],
    };
    const wrapper = await open(m);
    await wrapper.find("[data-testid=save]").trigger("click");
    await flushPromises();
    const sent = mutate.mock.calls[0][0].stageIds;
    expect(sent).toContain("9");
    expect(sent).not.toContain("8");
  });
});

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
