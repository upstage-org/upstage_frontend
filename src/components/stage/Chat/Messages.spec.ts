// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/** #1567: a per-viewer switch puts the clock time on every chat line. */

const store = vi.hoisted(() => ({
  chat: { showTimestamps: false },
  canPlay: false,
  session: "me",
}));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const s = reactive(store);
  return { useStageStore: () => s };
});

import Messages from "./Messages.vue";
import { useStageStore } from "@stores/pinia/stage";

const stubs = {
  ContextMenu: { template: "<div><slot name='trigger' /></div>" },
  Linkify: { template: "<span><slot /></span>" },
  Divider: true,
  Icon: true,
  "a-tooltip": { template: "<span><slot /></span>" },
};
const at = new Date(2026, 10, 20, 14, 32).getTime();
const messages = [{ user: "helen", message: "hello", at, isPlayer: true, session: "x" }];
const mountMessages = () =>
  mount(Messages, {
    props: { messages },
    global: { stubs, mocks: { $t: (k: string) => k } },
  });

describe("chat line timestamps", () => {
  it("are hidden by default", () => {
    (useStageStore() as unknown as typeof store).chat.showTimestamps = false;
    expect(mountMessages().find("[data-testid=chat-time]").exists()).toBe(false);
  });

  it("show the clock time once the viewer turns them on", async () => {
    (useStageStore() as unknown as typeof store).chat.showTimestamps = true;
    const wrapper = mountMessages();
    const time = wrapper.find("[data-testid=chat-time]");
    expect(time.exists()).toBe(true);
    expect(time.text()).toMatch(/^(14:32|20 Nov 14:32)$/);
    expect(wrapper.text()).toContain("helen:");
  });
});
