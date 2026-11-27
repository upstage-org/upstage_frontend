// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

const stageAccessOverview = vi.hoisted(() => vi.fn());
vi.mock("services/graphql", () => ({ stageGraph: { stageAccessOverview } }));

import StageAccessList from "./StageAccessList.vue";

const global = {
  stubs: {
    ASpin: { template: "<i class='spin-stub' />" },
    ATag: { template: "<span class='tag-stub'><slot /></span>" },
  },
};
const mountList = async () => {
  const wrapper = mount(StageAccessList, { props: { player: { id: 7 } }, global });
  expect(wrapper.find(".spin-stub").exists()).toBe(true);
  await flushPromises();
  return wrapper;
};

beforeEach(() => {
  stageAccessOverview.mockReset();
});

describe("StageAccessList", () => {
  it("lists the player's stages, strongest access first, ids as number or string", async () => {
    stageAccessOverview.mockResolvedValue({
      stages: {
        edges: [
          {
            id: "1",
            name: "Plays",
            fileLocation: "plays",
            owner: { id: 1 },
            playerAccess: "[[7],[]]",
          },
          {
            id: "2",
            name: "Edits",
            fileLocation: "edits",
            owner: { id: 1 },
            playerAccess: '[[],["7"]]',
          },
          { id: "3", name: "Owns", fileLocation: "owns", owner: { id: "7" }, playerAccess: null },
          {
            id: "4",
            name: "Other",
            fileLocation: "other",
            owner: { id: 1 },
            playerAccess: "[[8],[9]]",
          },
          {
            id: "5",
            name: "Broken",
            fileLocation: "broken",
            owner: null,
            playerAccess: "{not json",
          },
          {
            id: "6",
            name: "Also plays",
            fileLocation: "also",
            owner: { id: 1 },
            playerAccess: '[["7"],[]]',
          },
        ],
      },
    });
    const wrapper = await mountList();
    expect(
      wrapper.findAll("li").map((li) => `${li.find("a").text()} ${li.find(".tag-stub").text()}`),
    ).toEqual(["Owns Owner", "Edits Editor", "Also plays Player", "Plays Player"]);
    expect(wrapper.find("li a").attributes("href")).toBe("/owns");
  });

  it("says so when the player has no stage access", async () => {
    stageAccessOverview.mockResolvedValue({ stages: { edges: [] } });
    const wrapper = await mountList();
    expect(wrapper.find(".access-note").text()).toContain("No stage access");
  });

  it("reports a failed request", async () => {
    stageAccessOverview.mockRejectedValue(new Error("boom"));
    const wrapper = await mountList();
    expect(wrapper.find(".access-note").text()).toBe("Could not load stages: boom");
  });
});
