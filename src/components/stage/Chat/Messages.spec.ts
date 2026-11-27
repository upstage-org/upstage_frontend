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
import en from "../../../i18n/en";
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

// The real English strings, so the wording itself is under test.
const t = (k: string) => {
  const value = (en as Record<string, unknown>)[k];
  return typeof value === "string" ? value : k;
};
const mountEmpty = (props: Record<string, unknown> = {}) =>
  mount(Messages, {
    props: { messages: [], ...props },
    global: { stubs, mocks: { $t: t } },
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

/**
 * #1581: an empty chat greets the viewer and points at the input, and is
 * readable on the light chat as well as the dark one.
 */
describe("empty chat", () => {
  it("where the viewer can type, welcomes them and points at the field below", () => {
    const empty = mountEmpty({ welcome: true }).find("[data-testid=chat-empty]");
    expect(empty.exists()).toBe(true);
    const lines = empty.findAll("p").map((p) => p.text());
    expect(lines).toEqual(["Welcome to UpStage!", "Type in the field below to chat."]);
    expect(empty.find(".chat-empty-title").text()).toBe("Welcome to UpStage!");
    expect(empty.find(".chat-empty-hint").text()).toBe("Type in the field below to chat.");
    expect(empty.text()).not.toContain("No messages yet!");
  });

  it("where there is no field (replay, archived transcript), only says there are no messages", () => {
    const empty = mountEmpty().find("[data-testid=chat-empty]");
    expect(empty.findAll("p").map((p) => p.text())).toEqual(["No messages yet!"]);
    expect(empty.find(".chat-empty-hint").exists()).toBe(false);
    expect(empty.text()).not.toContain("field below");
  });

  it("carries no colour of its own, so it follows the chat's light or dark text colour", () => {
    // `has-text-light` pinned it to near-white (invisible on the light chat)
    // and Bulma's `subtitle` pins a dark grey (wrong on the dark chat).
    for (const props of [{ welcome: true }, {}]) {
      const empty = mountEmpty(props).find("[data-testid=chat-empty]");
      const classes = [empty, ...empty.findAll("*")].flatMap((el) => el.classes());
      expect(classes.filter((c) => /^has-text-(?!centered)/.test(c))).toEqual([]);
      expect(classes).not.toContain("subtitle");
      expect(classes).not.toContain("title");
      for (const el of [empty, ...empty.findAll("*")]) {
        expect((el.element as HTMLElement).style.color).toBe("");
      }
    }
  });

  it("gives way to the messages as soon as there is one", () => {
    const wrapper = mount(Messages, {
      props: { messages, welcome: true },
      global: { stubs, mocks: { $t: t } },
    });
    expect(wrapper.find("[data-testid=chat-empty]").exists()).toBe(false);
    expect(wrapper.text()).toContain("hello");
    expect(wrapper.text()).not.toContain("Welcome to UpStage!");
  });

  it("comes back when the chat is cleared", async () => {
    const wrapper = mount(Messages, {
      props: { messages, welcome: true },
      global: { stubs, mocks: { $t: t } },
    });
    await wrapper.setProps({ messages: [] });
    expect(wrapper.find(".chat-empty-title").text()).toBe("Welcome to UpStage!");
  });

  it("keeps the layout hooks of the on-stage and popped-out chat", () => {
    expect(mountEmpty().find("[data-testid=chat-empty]").classes()).toContain("is-fullheight");
    const standalone = mount(Messages, {
      props: { messages: [] },
      global: { stubs, mocks: { $t: t }, provide: { isChatStandalone: true } },
    }).find("[data-testid=chat-empty]");
    expect(standalone.classes()).toContain("chat-empty-standalone");
    expect(standalone.classes()).not.toContain("is-fullheight");
  });

  it("the English wording is what was asked for", () => {
    expect(en.chat_welcome_title).toBe("Welcome to UpStage!");
    expect(en.chat_welcome_hint).toBe("Type in the field below to chat.");
    expect(en.chat_no_messages).toBe("No messages yet!");
  });
});
