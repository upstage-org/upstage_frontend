// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";

/**
 * Chat timestamps in the Archive tab of Stage Management (#1567).
 *
 * Once a stage is swept its chat lives here, so this is where players look
 * for chat logs. One "Include timestamps" switch decides for the whole tab:
 * the transcript windows show each line's date and time, and every
 * downloaded log carries "[YYYY-MM-DD HH:mm:ss] " in front of each line.
 * Off — the default — the logs are exactly what they always were.
 */

vi.mock("services/graphql/composable", async () => {
  const { ref: vueRef } = await import("vue");
  return { useMutation: () => ({ loading: vueRef(false), save: vi.fn() }) };
});
vi.mock("services/graphql", () => ({ stageGraph: {} }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("ant-design-vue", () => ({ message: { success: vi.fn(), error: vi.fn() } }));

import Archive from "./Archive.vue";

const STORAGE_KEY = "upstage-archive-chat-timestamps";
const at = (h: number, m: number, s: number) => new Date(2026, 10, 24, h, m, s).getTime();

/** Two archived performances; the newer one (id 2) is listed first. */
const makeStage = () =>
  ref({
    id: 7,
    name: "Demo Stage",
    fileLocation: "demo",
    performances: [
      { id: 1, name: "First night", createdOn: "2026-11-23T10:00:00Z" },
      { id: 2, name: "", createdOn: "2026-11-24T13:00:00Z" },
    ],
    chats: [
      { performanceId: 1, payload: { user: "romeo", message: "older line", at: at(9, 0, 1) } },
      { performanceId: 2, payload: { user: "helen", message: "hello", at: at(12, 47, 59) } },
      { performanceId: 2, payload: { user: "guest", message: "hi all", at: at(12, 48, 3) } },
      { performanceId: 2, payload: { clear: true, at: at(12, 50, 0) } },
      { performanceId: 2, payload: { user: "helen", message: "after clear", at: at(12, 51, 7) } },
      {
        performanceId: 2,
        payload: { user: "juliet", message: "backstage", at: at(12, 49, 30), isPrivate: true },
      },
      { performanceId: 2, payload: { clearPlayerChat: true, at: at(12, 52, 0) } },
      { performanceId: 2, payload: { user: "old", message: "no time recorded" } },
    ],
  });

class FakeBlob {
  parts: string[];
  constructor(parts: string[]) {
    this.parts = parts;
  }
}
let lastBlob: FakeBlob | null = null;

const mounted: Array<{ unmount: () => void }> = [];
function mountArchive() {
  const w = mount(Archive, {
    attachTo: document.body,
    global: {
      provide: { stage: makeStage(), refresh: vi.fn() },
      mocks: { $t: (k: string) => k },
      stubs: {
        // One block per performance, with the two chat columns.
        DataTable: {
          props: ["data", "headers"],
          template: `<div><div v-for="item in data" :key="item.id" class="row" :data-id="item.id">
            <div class="public"><slot name="public-chat" :item="item" /></div>
            <div class="private"><slot name="private-chat" :item="item" /></div>
          </div></div>`,
        },
        // The transcript window, always open.
        Modal: {
          template: "<div class='modal-stub'><slot name='trigger' /><slot name='content' /></div>",
        },
        Messages: {
          props: {
            messages: Array,
            showTimes: { type: Boolean, default: undefined },
            fullTimes: Boolean,
          },
          template: `<div class="messages-stub" :data-show-times="String(showTimes)" :data-full-times="String(fullTimes)" :data-count="messages.length" />`,
        },
        CustomConfirm: true,
        Field: true,
        ClearChat: true,
        SweepStage: true,
        Icon: true,
        Loading: true,
        "router-link": true,
        "a-tooltip": { template: "<span><slot /></span>" },
      },
    },
  });
  mounted.push(w);
  return w;
}
type Tab = ReturnType<typeof mountArchive>;

const toggle = (w: Tab) => w.find('input[data-testid="archive-chat-timestamps"]');
const setSwitch = async (w: Tab, on: boolean) => {
  (toggle(w).element as HTMLInputElement).checked = on;
  await toggle(w).trigger("input");
};
/** Click a download button and return the file's name and text. */
const download = async (button: ReturnType<Tab["find"]>) => {
  lastBlob = null;
  document.body.querySelectorAll("a[download]").forEach((a) => a.remove());
  await button.trigger("click");
  const link = document.body.querySelector("a[download]") as HTMLAnchorElement;
  return {
    name: link.getAttribute("download"),
    text: (lastBlob as FakeBlob | null)!.parts.join(""),
  };
};
const allAudience = (w: Tab) =>
  w.findAll("button").find((b) => b.text() === "download_all_audience_chat")!;
const allPlayer = (w: Tab) =>
  w.findAll("button").find((b) => b.text() === "download_all_player_chat")!;
const rowDownload = (w: Tab, id: number, column: "public" | "private") =>
  w.find(`.row[data-id="${id}"] .${column} > button`);

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  vi.stubGlobal("Blob", FakeBlob);
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  window.URL.createObjectURL = vi.fn((blob: unknown) => {
    lastBlob = blob as FakeBlob;
    return "blob:test";
  });
  window.URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  document.body.querySelectorAll("a[download]").forEach((a) => a.remove());
  vi.unstubAllGlobals();
});

describe("Archive tab: the Include timestamps switch", () => {
  it("is there, labelled like the on-stage download option, and off by default", () => {
    const w = mountArchive();
    expect(toggle(w).exists()).toBe(true);
    expect((toggle(w).element as HTMLInputElement).checked).toBe(false);
    expect(w.find(".archive-chat-timestamps").text()).toContain("include_timestamps");
  });

  it("is remembered in this browser", async () => {
    const first = mountArchive();
    await setSwitch(first, true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
    const second = mountArchive();
    expect((toggle(second).element as HTMLInputElement).checked).toBe(true);
    await setSwitch(second, false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
    expect((toggle(mountArchive()).element as HTMLInputElement).checked).toBe(false);
  });
});

describe("Archive tab: downloads with the switch OFF are exactly the old logs", () => {
  it("one performance, audience chat", async () => {
    const file = await download(rowDownload(mountArchive(), 2, "public"));
    expect(file.text).toBe(
      "helen: hello\r\n" +
        "guest: hi all\r\n" +
        "---------------- Clear Chat ----------------\r\n" +
        "helen: after clear\r\n" +
        "old: no time recorded\r\n",
    );
    expect(file.name).toMatch(/^Demo Stage-Audience-chat-\d{4}-\d{8}\.txt$/);
  });

  it("one performance, player chat", async () => {
    const file = await download(rowDownload(mountArchive(), 2, "private"));
    expect(file.text).toBe("juliet: backstage\r\n---------------- Clear Chat ----------------\r\n");
    expect(file.name).toMatch(/^Demo Stage-Player-chat-\d{4}-\d{8}\.txt$/);
  });

  it("all audience chat, newest performance first", async () => {
    const file = await download(allAudience(mountArchive()));
    expect(file.text).toBe(
      "helen: hello\r\n" +
        "guest: hi all\r\n" +
        "---------------- Clear Chat ----------------\r\n" +
        "helen: after clear\r\n" +
        "old: no time recorded\r\n" +
        "romeo: older line\r\n",
    );
    expect(file.name).toBe("Demo Stage-Audience-chat.txt");
  });

  it("all player chat", async () => {
    const file = await download(allPlayer(mountArchive()));
    expect(file.text).toBe("juliet: backstage\r\n---------------- Clear Chat ----------------\r\n");
    expect(file.name).toBe("Demo Stage-Player-chat.txt");
  });
});

describe("Archive tab: downloads with the switch ON carry the date and time", () => {
  it("one performance, audience chat", async () => {
    const w = mountArchive();
    await setSwitch(w, true);
    const file = await download(rowDownload(w, 2, "public"));
    expect(file.text).toBe(
      "[2026-11-24 12:47:59] helen: hello\r\n" +
        "[2026-11-24 12:48:03] guest: hi all\r\n" +
        "---------------- Clear Chat (2026-11-24 12:50:00) ----------------\r\n" +
        "[2026-11-24 12:51:07] helen: after clear\r\n" +
        // A line stored without a time stays as it is.
        "old: no time recorded\r\n",
    );
    // Same file name either way.
    expect(file.name).toMatch(/^Demo Stage-Audience-chat-\d{4}-\d{8}\.txt$/);
  });

  it("one performance, player chat", async () => {
    const w = mountArchive();
    await setSwitch(w, true);
    const file = await download(rowDownload(w, 2, "private"));
    expect(file.text).toBe(
      "[2026-11-24 12:49:30] juliet: backstage\r\n" +
        "---------------- Clear Chat (2026-11-24 12:52:00) ----------------\r\n",
    );
  });

  it("all audience chat and all player chat", async () => {
    const w = mountArchive();
    await setSwitch(w, true);
    const audience = await download(allAudience(w));
    expect(audience.text.split("\r\n")).toEqual([
      "[2026-11-24 12:47:59] helen: hello",
      "[2026-11-24 12:48:03] guest: hi all",
      "---------------- Clear Chat (2026-11-24 12:50:00) ----------------",
      "[2026-11-24 12:51:07] helen: after clear",
      "old: no time recorded",
      "[2026-11-24 09:00:01] romeo: older line",
      "",
    ]);
    const player = await download(allPlayer(w));
    expect(player.text).toContain("[2026-11-24 12:49:30] juliet: backstage\r\n");
  });

  it("switching it off again gives the plain log again", async () => {
    const w = mountArchive();
    await setSwitch(w, true);
    await setSwitch(w, false);
    const file = await download(rowDownload(w, 1, "public"));
    expect(file.text).toBe("romeo: older line\r\n");
  });
});

describe("Archive tab: the transcript windows follow the switch", () => {
  it("off: no times; on: full date and time — for audience and player chat alike", async () => {
    const w = mountArchive();
    const lists = () => w.findAll(".messages-stub");
    expect(lists()).toHaveLength(4); // 2 performances × audience/player
    for (const list of lists()) {
      expect(list.attributes("data-show-times")).toBe("false");
      expect(list.attributes("data-full-times")).toBe("true");
    }
    await setSwitch(w, true);
    for (const list of lists()) {
      expect(list.attributes("data-show-times")).toBe("true");
      expect(list.attributes("data-full-times")).toBe("true");
    }
    // The lists themselves are unchanged by the switch.
    expect(lists().map((l) => l.attributes("data-count"))).toEqual(["5", "2", "1", "0"]);
  });
});
