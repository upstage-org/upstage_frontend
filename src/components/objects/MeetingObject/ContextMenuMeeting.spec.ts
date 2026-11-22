// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * #1566 follow-up: a meeting gets a right-click menu with "Add prop to
 * meeting", which hands the meeting to the store as the attach target (the
 * store opens the Props panel) and closes the menu.
 */

const { startAttachingProp } = vi.hoisted(() => ({ startAttachingProp: vi.fn() }));
vi.mock("@stores/pinia/stage", () => ({
  useStageStore: () => ({ startAttachingProp }),
}));

import ContextMenuMeeting from "./ContextMenuMeeting.vue";

const closeMenu = vi.fn();
const mountMenu = () =>
  mount(ContextMenuMeeting, {
    props: { object: { id: "room-1" }, closeMenu },
    global: { mocks: { $t: (key: string) => key }, stubs: { Icon: true } },
  });

beforeEach(() => {
  startAttachingProp.mockClear();
  closeMenu.mockClear();
});

describe("ContextMenuMeeting", () => {
  it("offers 'Add prop to meeting'", () => {
    const w = mountMenu();
    expect(w.find('[data-testid="meeting-add-prop"]').text()).toBe("add_prop_to_meeting");
  });

  it("starts attaching to this meeting and closes the menu", async () => {
    const w = mountMenu();
    await w.find('[data-testid="meeting-add-prop"]').trigger("click");
    expect(startAttachingProp).toHaveBeenCalledWith("room-1");
    expect(closeMenu).toHaveBeenCalledTimes(1);
  });
});
