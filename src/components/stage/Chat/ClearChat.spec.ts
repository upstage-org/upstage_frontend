// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * The on-stage "clear chat" button lives in the PUBLIC chat panel (mounted
 * for the audience too) and publishes with its own broker client, bypassing
 * the stage store's publish gate. Rule (2026-09): the audience watches,
 * chats and reacts — it cannot clear chat.
 */

const { connect, sendMessage, state } = vi.hoisted(() => ({
  connect: vi.fn(),
  sendMessage: vi.fn(() => Promise.resolve()),
  state: { store: null as Record<string, unknown> | null },
}));

vi.mock("services/mqtt", () => ({ default: () => ({ connect, sendMessage }) }));
vi.mock("vue-router", () => ({ useRoute: () => ({ params: { url: "demo" } }) }));
vi.mock("ant-design-vue", () => ({ message: { success: vi.fn(), error: vi.fn() } }));
vi.mock("store/modules/stage/reusable", () => ({
  namespaceTopic: (topic: string, url: string) => `ns/${url}/${topic}`,
}));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({
    showClearChatSetting: true,
    canPlay: false,
    model: { mqtt: { username: "u", password: "p" } },
  });
  state.store = store as unknown as Record<string, unknown>;
  return { useStageStore: () => store };
});

import ClearChat from "./ClearChat.vue";

const mountButton = () =>
  mount(ClearChat, {
    props: { option: "public-chat" },
    global: { stubs: { Icon: true }, mocks: { $t: (k: string) => k } },
  });

beforeEach(() => {
  connect.mockReset();
  sendMessage.mockClear();
  state.store!.showClearChatSetting = true;
  state.store!.canPlay = false;
});

describe("on-stage clear-chat button", () => {
  it("is not offered to a session that is not performing", () => {
    expect(mountButton().find("button").exists()).toBe(false);
  });

  it("refuses to publish for a non-performing session even if invoked directly", async () => {
    const wrapper = mountButton();
    await (wrapper.vm as unknown as { clearChat: () => Promise<void> }).clearChat();
    expect(connect).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("still works for a performer", async () => {
    state.store!.canPlay = true;
    connect.mockReturnValue({ on: (_event: string, cb: () => void) => cb() });
    const wrapper = mountButton();
    await wrapper.find("button").trigger("click");
    await new Promise((resolve) => setTimeout(resolve));
    expect(sendMessage).toHaveBeenCalledWith("ns/demo/chat", { clear: true }, true);
  });

  it("stays hidden for a performer while the setting is off (unchanged)", () => {
    state.store!.canPlay = true;
    state.store!.showClearChatSetting = false;
    expect(mountButton().find("button").exists()).toBe(false);
  });
});
