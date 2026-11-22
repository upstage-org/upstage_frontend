// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";

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
            { id: "5", name: "Bunnies", permission: "editor" },
            { id: 6, name: "apple stage", permission: "owner" },
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

/**
 * #1569, second round: the pop-up is two columns — the stages this user
 * manages that the item is NOT on (left) and the ones it IS on (right);
 * clicking a name moves it. Before, a multi-select was filled once and
 * emptied after each save, so on the second opening nothing was ticked and
 * saving silently unassigned the item ("the only way to unassign is to
 * assign to another stage").
 */
describe("QuickStageAssignment two columns (#1569)", () => {
  const names = (wrapper: Awaited<ReturnType<typeof open>>, column: string) =>
    wrapper.findAll(`[data-testid=${column}] button`).map((b) => b.text());
  const click = async (wrapper: Awaited<ReturnType<typeof open>>, column: string, name: string) => {
    const button = wrapper.findAll(`[data-testid=${column}] button`).find((b) => b.text() === name);
    expect(button, `${name} in ${column}`).toBeTruthy();
    await button!.trigger("click");
  };
  const onBunnies = () => ({ ...media(0), stages: [{ id: "5", name: "Bunnies" }] });

  it("lists only the stages the user owns or edits, sorted, split by whether the item is on them", async () => {
    const wrapper = await open(onBunnies());
    expect(names(wrapper, "available-stages")).toEqual(["apple stage", "Mine"]);
    expect(names(wrapper, "assigned-stages")).toEqual(["Bunnies"]);
    expect(wrapper.text()).not.toContain("Theirs (player access)");
  });

  it("assigns by clicking a name on the left", async () => {
    mutate.mockResolvedValue({});
    const wrapper = await open(onBunnies());
    await click(wrapper, "available-stages", "Mine");
    expect(names(wrapper, "assigned-stages")).toEqual(["Bunnies", "Mine"]);
    expect(names(wrapper, "available-stages")).toEqual(["apple stage"]);
    await wrapper.find("[data-testid=save]").trigger("click");
    await flushPromises();
    expect(mutate.mock.calls[0][0].stageIds.sort()).toEqual(["5", "7"]);
  });

  it("unassigns by clicking a name on the right, without assigning it anywhere else", async () => {
    mutate.mockResolvedValue({});
    const wrapper = await open(onBunnies());
    await click(wrapper, "assigned-stages", "Bunnies");
    expect(names(wrapper, "assigned-stages")).toEqual([]);
    expect(names(wrapper, "available-stages")).toEqual(["apple stage", "Bunnies", "Mine"]);
    await wrapper.find("[data-testid=save]").trigger("click");
    await flushPromises();
    expect(mutate).toHaveBeenCalledWith({ assetId: "1", stageIds: [] });
    expect(toast.success).toHaveBeenCalled();
  });

  it("unassigning from my stage keeps the owner's own assignment on a stage I cannot manage", async () => {
    mutate.mockResolvedValue({});
    const m = {
      ...media(0),
      stages: [
        { id: "5", name: "Bunnies" },
        { id: "9", name: "Owner's stage" },
      ],
    };
    const wrapper = await open(m);
    expect(names(wrapper, "assigned-stages")).toEqual(["Bunnies"]);
    await click(wrapper, "assigned-stages", "Bunnies");
    await wrapper.find("[data-testid=save]").trigger("click");
    await flushPromises();
    expect(mutate.mock.calls[0][0].stageIds).toEqual(["9"]);
  });

  it("shows the current assignments again every time it is opened (they used to be blank after a save)", async () => {
    mutate.mockResolvedValue({});
    const m = onBunnies();
    const wrapper = await open(m);
    await click(wrapper, "available-stages", "Mine");
    await wrapper.find("[data-testid=save]").trigger("click");
    await flushPromises();
    expect(wrapper.find(".modal").exists()).toBe(false);

    // the media list refreshes after a save and hands the pop-up the new state
    await wrapper.setProps({
      media: {
        ...m,
        stages: [
          { id: "5", name: "Bunnies" },
          { id: "7", name: "Mine" },
        ],
      } as never,
    });
    await wrapper.find("button").trigger("click");
    await nextTick();
    expect(names(wrapper, "assigned-stages")).toEqual(["Bunnies", "Mine"]);
    expect(names(wrapper, "available-stages")).toEqual(["apple stage"]);
  });

  it("discards unsaved clicks when the pop-up is closed and opened again", async () => {
    const wrapper = await open(onBunnies());
    await click(wrapper, "assigned-stages", "Bunnies");
    (wrapper.vm as unknown as { visible: boolean }).visible = false;
    await nextTick();
    await wrapper.find("button").trigger("click");
    await nextTick();
    expect(names(wrapper, "assigned-stages")).toEqual(["Bunnies"]);
  });

  it("matches a numeric stage id from the API against the item's string id", async () => {
    const wrapper = await open({ ...media(0), stages: [{ id: "6", name: "apple stage" }] });
    expect(names(wrapper, "assigned-stages")).toEqual(["apple stage"]);
  });

  it("filters each column with its search box", async () => {
    const wrapper = await open(onBunnies());
    await wrapper.find("[data-testid=available-stages] input").setValue("APP");
    expect(names(wrapper, "available-stages")).toEqual(["apple stage"]);
    await wrapper.find("[data-testid=assigned-stages] input").setValue("zzz");
    expect(names(wrapper, "assigned-stages")).toEqual([]);
    expect(wrapper.find("[data-testid=assigned-stages]").text()).toContain(
      "No assigned stages match",
    );
  });

  it("a refused save keeps the pop-up open with the user's choices", async () => {
    mutate.mockRejectedValue(new Error("You can only assign media to stages you own or edit"));
    const wrapper = await open(onBunnies());
    await click(wrapper, "available-stages", "Mine");
    await wrapper.find("[data-testid=save]").trigger("click");
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith("You can only assign media to stages you own or edit");
    expect(names(wrapper, "assigned-stages")).toEqual(["Bunnies", "Mine"]);
  });
});
