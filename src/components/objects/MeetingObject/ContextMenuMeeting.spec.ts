// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * #1566 follow-up: a meeting gets a right-click menu with "Add prop to
 * meeting", which hands the meeting to the store as the attach target (the
 * store opens the Props panel) and closes the menu.
 *
 * #1580: the same menu lets a player choose what the audience may use in
 * the meeting (off / microphone / microphone + camera) and explains how to
 * show one person to everyone.
 */

const { startAttachingProp, shapeObject, modalInfo } = vi.hoisted(() => ({
  startAttachingProp: vi.fn(),
  shapeObject: vi.fn(),
  modalInfo: vi.fn(),
}));
vi.mock("@stores/pinia/stage", () => ({
  useStageStore: () => ({ startAttachingProp, shapeObject }),
}));
vi.mock("ant-design-vue", () => ({ Modal: { info: modalInfo } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

import ContextMenuMeeting from "./ContextMenuMeeting.vue";

const closeMenu = vi.fn();
const MEETING = {
  id: "room-1",
  type: "meeting",
  name: "Workshop",
  x: 10,
  y: 20,
  w: 320,
  h: 240,
  rotate: 0,
};
const mountMenu = (object: Record<string, unknown> = {}) =>
  mount(ContextMenuMeeting, {
    props: { object: { ...MEETING, ...object }, closeMenu },
    global: { mocks: { $t: (key: string) => key }, stubs: { Icon: true } },
  });
const option = (w: ReturnType<typeof mountMenu>, level: string) =>
  w.find(`[data-testid="meeting-audience-tools-${level}"]`);
const selected = (w: ReturnType<typeof mountMenu>) =>
  ["none", "mic", "mic-camera"].filter(
    (level) => option(w, level).attributes("aria-checked") === "true",
  );

beforeEach(() => {
  startAttachingProp.mockClear();
  shapeObject.mockClear();
  modalInfo.mockClear();
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
    expect(shapeObject).not.toHaveBeenCalled();
  });
});

describe("ContextMenuMeeting: audience tools (#1580)", () => {
  it("lists the three levels under an 'Audience tools' heading", () => {
    const w = mountMenu();
    expect(w.find('[data-testid="meeting-audience-tools"]').text()).toBe("meeting_audience_tools");
    expect(option(w, "none").text()).toBe("meeting_audience_tools_none");
    expect(option(w, "mic").text()).toBe("meeting_audience_tools_mic");
    expect(option(w, "mic-camera").text()).toBe("meeting_audience_tools_mic_camera");
  });

  it.each([
    [undefined, "none"],
    [null, "none"],
    ["none", "none"],
    ["nonsense", "none"],
    ["mic", "mic"],
    ["mic-camera", "mic-camera"],
  ])("marks the level in force (setting %s → %s)", (setting, level) => {
    const w = mountMenu({ audienceTools: setting });
    expect(selected(w)).toEqual([level]);
    expect(option(w, level).find(".fa-check").exists()).toBe(true);
    expect(w.findAll(".fa-check")).toHaveLength(1);
  });

  it.each(["mic", "mic-camera"])(
    "choosing %s sends the whole meeting object with that level and closes the menu",
    async (level) => {
      const w = mountMenu();
      await option(w, level).trigger("click");
      expect(shapeObject).toHaveBeenCalledTimes(1);
      expect(shapeObject).toHaveBeenCalledWith({ ...MEETING, audienceTools: level });
      expect(closeMenu).toHaveBeenCalledTimes(1);
    },
  );

  it("switching off writes 'none' explicitly (a missing key could not undo an open level)", async () => {
    const w = mountMenu({ audienceTools: "mic-camera" });
    await option(w, "none").trigger("click");
    expect(shapeObject).toHaveBeenCalledWith({ ...MEETING, audienceTools: "none" });
    expect(closeMenu).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, "none"],
    ["none", "none"],
    ["nonsense", "none"],
    ["mic", "mic"],
    ["mic-camera", "mic-camera"],
  ])(
    "choosing the level already in force sends nothing (setting %s, pick %s)",
    async (setting, pick) => {
      const w = mountMenu({ audienceTools: setting });
      await option(w, pick).trigger("click");
      expect(shapeObject).not.toHaveBeenCalled();
      expect(closeMenu).toHaveBeenCalledTimes(1);
    },
  );

  it("changes nothing else about the meeting object", async () => {
    const meeting = { jitsiServer: "https://j2.test", opacity: 0.4, rotate: 15, wornBy: null };
    const w = mountMenu(meeting);
    await option(w, "mic").trigger("click");
    const sent = shapeObject.mock.calls[0][0];
    expect(sent).toEqual({ ...MEETING, ...meeting, audienceTools: "mic" });
  });

  it("explains where 'Everyone follows me' is, without sending anything", async () => {
    const w = mountMenu();
    await w.find('[data-testid="meeting-follow-me-help"]').trigger("click");
    expect(modalInfo).toHaveBeenCalledTimes(1);
    expect(modalInfo.mock.calls[0][0].title).toBe("meeting_show_to_everyone_title");
    expect(shapeObject).not.toHaveBeenCalled();
    expect(closeMenu).toHaveBeenCalledTimes(1);
  });
});
