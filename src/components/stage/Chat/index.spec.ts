// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

/**
 * Public chat panel and its empty-list message (#1581).
 *
 * An empty chat says "Welcome to UpStage! / Type in the field below to
 * chat." That second line is only true where the panel has an input, so the
 * panel asks the message list for the welcome exactly when it renders one:
 * live (on stage and popped out) yes, in a replay no.
 */

vi.mock("animejs", () => ({ animate: vi.fn() }));
vi.mock("composables/index", () => ({ useDraggablePanel: () => ({ startDrag: vi.fn() }) }));
vi.mock("@stores/pinia/user", () => ({ useUserStore: () => ({ loadingUser: false }) }));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive, ref } = await import("vue");
  // storeToRefs() only picks up ref / reactive members, so the ones the
  // panel destructures are explicit refs.
  const store = reactive({
    chatPosition: ref("right"),
    canPlay: ref(false),
    stageSize: ref({ left: 0, top: 0, width: 1000, height: 600 }),
    chat: ref({ messages: [], opacity: 0.9, fontSize: "14px" }),
    publicChatPosition: ref(null),
    settings: { chatVisibility: true, chatDarkMode: false },
    url: "demo",
    loadPermission: vi.fn(),
    setPublicChatPosition: vi.fn(),
    openSettingPopup: vi.fn(),
    sendChat: vi.fn(),
  });
  return { useStageStore: () => store };
});

import Chat from "./index.vue";
import { useStageStore } from "@stores/pinia/stage";

const mounted: Array<{ unmount: () => void }> = [];
const mountChat = (provide: Record<string, unknown> = {}) => {
  const wrapper = mount(Chat, {
    global: {
      provide,
      mocks: { $t: (k: string) => k },
      stubs: {
        Messages: {
          props: ["messages", "welcome"],
          template: "<div class='messages-stub' :data-welcome='String(welcome)' />",
        },
        ChatInput: { template: "<input class='chat-input-stub' />" },
        Reaction: true,
        ClearChat: true,
        Icon: true,
        "a-tooltip": { template: "<span><slot /></span>" },
      },
    },
  });
  mounted.push(wrapper);
  return wrapper;
};
const welcome = (w: ReturnType<typeof mountChat>) =>
  w.find(".messages-stub").attributes("data-welcome");
const hasInput = (w: ReturnType<typeof mountChat>) => w.find(".chat-input-stub").exists();

afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  (useStageStore() as unknown as { settings: { chatDarkMode: boolean } }).settings.chatDarkMode =
    false;
});

describe("public chat: welcome message goes with the input field", () => {
  it("live on stage: there is a field, and the list is asked to welcome", () => {
    const w = mountChat();
    expect(hasInput(w)).toBe(true);
    expect(welcome(w)).toBe("true");
  });

  it("popped-out chat window: same", () => {
    const w = mountChat({ isChatStandalone: true });
    expect(hasInput(w)).toBe(true);
    expect(welcome(w)).toBe("true");
  });

  it("replay: no field to type in, so no welcome pointing at one", () => {
    const w = mountChat({ replaying: true });
    expect(hasInput(w)).toBe(false);
    expect(welcome(w)).toBe("false");
  });
});

describe("public chat: light and dark mode", () => {
  it("marks the panel `dark` from the stage-wide setting, which sets the text colour the empty message inherits", async () => {
    const w = mountChat();
    expect(w.find("#chatbox").classes()).not.toContain("dark");
    (useStageStore() as unknown as { settings: { chatDarkMode: boolean } }).settings.chatDarkMode =
      true;
    await w.vm.$nextTick();
    expect(w.find("#chatbox").classes()).toContain("dark");
  });
});
