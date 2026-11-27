// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * Audience tools in an embedded meeting (#1580): what the meeting tile does
 * with the board object's `audienceTools` setting.
 *
 *  - An AUDIENCE member's iframe gets the toolbar buttons and the browser
 *    permission of the chosen level, and is reloaded when the level changes
 *    (the only way Jitsi and the browser pick it up) — and at no other time.
 *  - A PERFORMER's iframe is never touched: same address, same permissions,
 *    same DOM node, whatever the level is or becomes. That includes a
 *    performer previewing the stage as audience.
 *  - A replay never opens a microphone.
 *
 * What everything looked like before this feature is pinned separately in
 * `index.frozen.spec.ts`.
 */

const { modalConfirm } = vi.hoisted(() => ({ modalConfirm: vi.fn() }));
vi.mock("ant-design-vue", () => ({ Modal: { confirm: modalConfirm } }));
vi.mock("vue-i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock("./composable", () => ({
  useJitsiEndpoint: () => ({ host: "meet.test", httpScheme: "https" }),
}));
vi.mock("@stores/pinia/stage", async () => {
  const { reactive } = await import("vue");
  const store = reactive({ canPlay: false, meetingRefreshKey: 0, activeMovable: false });
  return { useStageStore: () => store };
});
vi.mock("@stores/pinia/user", () => ({
  useUserStore: () => ({ chatname: "Tester", user: null }),
}));

import { useStageStore } from "@stores/pinia/stage";
import MeetingObject from "./index.vue";

type StoreMock = { canPlay: boolean; meetingRefreshKey: number };
const store = () => useStageStore() as unknown as StoreMock;

const TIMEOUT_MS = 15000;
const BASE = { id: "m1", type: "meeting", name: "room-1", w: 640, h: 360, x: 10, y: 10 };

const mounted: Array<{ unmount: () => void }> = [];
function mountTile(object: Record<string, unknown> = {}, provide: Record<string, unknown> = {}) {
  const w = mount(MeetingObject, {
    props: { object: { ...BASE, ...object } },
    attachTo: document.body,
    global: {
      provide,
      mocks: { $t: (k: string) => k },
      stubs: { AppObject: { template: "<div><slot name='render' /></div>" } },
    },
  });
  mounted.push(w);
  return w;
}
type Tile = ReturnType<typeof mountTile>;
const iframe = (w: Tile) => w.find("iframe");
const spinner = (w: Tile) => w.find("img.overlay");
/** The board hands the tile a new object on every change, as the store does. */
const update = async (w: Tile, patch: Record<string, unknown>) => {
  await w.setProps({ object: { ...(w.props("object") as object), ...patch } });
  await nextTick();
};

/** `config.x=<json>` pairs of an iframe address, decoded. */
function settings(src: string | undefined): Record<string, unknown> {
  const fragment = (src ?? "").split("#")[1] ?? "";
  return Object.fromEntries(
    fragment.split("&").map((pair) => {
      const i = pair.indexOf("=");
      return [pair.slice(0, i), JSON.parse(decodeURIComponent(pair.slice(i + 1)))];
    }),
  );
}
const MIC_BUTTONS = ["microphone", "raisehand", "tileview"];
const CAM_BUTTONS = ["microphone", "camera", "raisehand", "tileview"];

beforeEach(() => {
  vi.useFakeTimers();
  modalConfirm.mockReset();
  store().canPlay = false;
  store().meetingRefreshKey = 0;
});
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  vi.useRealTimers();
});

describe("audience: an open level", () => {
  it("microphone: toolbar and permission for the microphone, nothing else changes", () => {
    const off = settings(iframe(mountTile()).attributes("src"));
    const el = iframe(mountTile({ audienceTools: "mic" }));
    const mic = settings(el.attributes("src"));

    expect(mic["config.toolbarButtons"]).toEqual(MIC_BUTTONS);
    expect(mic["interfaceConfig.TOOLBAR_BUTTONS"]).toEqual(MIC_BUTTONS);
    expect(mic["config.disableSelfView"]).toBe(false);
    expect(el.attributes("allow")).toBe("microphone; autoplay");
    expect(el.attributes("allowfullscreen")).toBeUndefined();

    // Every other setting — and their order — is the watch-only one.
    expect(Object.keys(mic)).toEqual(Object.keys(off));
    for (const key of Object.keys(off)) {
      if (
        [
          "config.toolbarButtons",
          "interfaceConfig.TOOLBAR_BUTTONS",
          "config.disableSelfView",
        ].includes(key)
      ) {
        continue;
      }
      expect(mic[key], key).toEqual(off[key]);
    }
  });

  it("microphone + camera: adds the camera button and permission", () => {
    const el = iframe(mountTile({ audienceTools: "mic-camera" }));
    const s = settings(el.attributes("src"));
    expect(s["config.toolbarButtons"]).toEqual(CAM_BUTTONS);
    expect(s["interfaceConfig.TOOLBAR_BUTTONS"]).toEqual(CAM_BUTTONS);
    expect(el.attributes("allow")).toBe("camera; microphone; autoplay");
    expect(el.attributes("allowfullscreen")).toBeUndefined();
  });

  it.each(["mic", "mic-camera"])(
    "%s keeps every protection of the watch-only audience",
    (level) => {
      const el = iframe(mountTile({ audienceTools: level }));
      const s = settings(el.attributes("src"));
      // Joins muted, no device prompt until the person presses the button.
      expect(s["config.startAudioMuted"]).toBe(1);
      expect(s["config.startVideoMuted"]).toBe(1);
      expect(s["config.disableInitialGUM"]).toBe(true);
      // No hang-up, no shortcuts that could trigger hidden actions.
      expect(s["config.toolbarButtons"]).not.toContain("hangup");
      expect(s["config.disableShortcuts"]).toBe(true);
      // No control over other people, no moderator affordances.
      expect(s["config.disableRemoteMute"]).toBe(true);
      expect(s["config.remoteVideoMenu"]).toEqual({
        disabled: true,
        disableKick: true,
        disableGrantModerator: true,
        disablePrivateChat: "all",
        disableDemote: true,
      });
      expect(s["config.participantsPane"]).toEqual({
        hideModeratorSettingsTab: true,
        hideMoreActionsButton: true,
        hideMuteAllButton: true,
      });
      expect(s["config.readOnlyName"]).toBe(true);
      expect(s["config.disableInviteFunctions"]).toBe(true);
      expect(s["config.disableProfile"]).toBe(true);
      expect(s["interfaceConfig.SETTINGS_SECTIONS"]).toEqual([]);
      expect(s["interfaceConfig.SHARING_FEATURES"]).toEqual([]);
      // Never screen sharing, never fullscreen.
      expect(el.attributes("allow")).not.toContain("display-capture");
      expect(el.attributes("allowfullscreen")).toBeUndefined();
    },
  );
});

describe("audience: changing the level reloads their iframe — and only that does", () => {
  it("off → microphone: a new iframe with the new address and permission", async () => {
    const w = mountTile();
    await iframe(w).trigger("load");
    const before = iframe(w).element;
    expect(iframe(w).attributes("allow")).toBe("autoplay");

    await update(w, { audienceTools: "mic" });

    expect(iframe(w).element).not.toBe(before);
    expect(iframe(w).attributes("allow")).toBe("microphone; autoplay");
    expect(settings(iframe(w).attributes("src"))["config.toolbarButtons"]).toEqual(MIC_BUTTONS);
    expect(spinner(w).exists()).toBe(true);
    expect(modalConfirm).not.toHaveBeenCalled();
  });

  it("microphone → off: the permission is gone with the reload", async () => {
    const offSrc = iframe(mountTile()).attributes("src");
    const w = mountTile({ audienceTools: "mic" });
    await iframe(w).trigger("load");
    const before = iframe(w).element;

    await update(w, { audienceTools: "none" });

    expect(iframe(w).element).not.toBe(before);
    expect(iframe(w).attributes("allow")).toBe("autoplay");
    expect(iframe(w).attributes("src")).toBe(offSrc);
  });

  it("microphone → microphone + camera and back", async () => {
    const w = mountTile({ audienceTools: "mic" });
    const first = iframe(w).element;
    await update(w, { audienceTools: "mic-camera" });
    const second = iframe(w).element;
    expect(second).not.toBe(first);
    expect(iframe(w).attributes("allow")).toBe("camera; microphone; autoplay");
    await update(w, { audienceTools: "mic" });
    expect(iframe(w).element).not.toBe(second);
    expect(iframe(w).attributes("allow")).toBe("microphone; autoplay");
  });

  it("the reload restarts the load timer (a rejoin that never loads still fails over)", async () => {
    const w = mountTile();
    await iframe(w).trigger("load");
    await update(w, { audienceTools: "mic" });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(w.find(".failed").exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.find(".failed").exists()).toBe(true);
  });

  it("the same level arriving again does NOT reload (the store rebuilds objects constantly)", async () => {
    const w = mountTile({ audienceTools: "mic" });
    await iframe(w).trigger("load");
    const before = iframe(w).element;
    for (let i = 0; i < 5; i += 1) {
      await update(w, { audienceTools: "mic" });
      await update(w, {});
    }
    expect(iframe(w).element).toBe(before);
    expect(spinner(w).exists()).toBe(false);
  });

  it("moving, resizing or any other change to the meeting does NOT reload", async () => {
    const w = mountTile({ audienceTools: "mic" });
    await iframe(w).trigger("load");
    const before = iframe(w).element;
    await update(w, { x: 300, y: 200 });
    await update(w, { w: 800, h: 450 });
    await update(w, { opacity: 0.5, rotate: 10, holder: { id: "s1" }, published: true });
    expect(iframe(w).element).toBe(before);
    expect(spinner(w).exists()).toBe(false);
  });

  it("values that all mean 'off' are one level: switching between them does NOT reload", async () => {
    const w = mountTile();
    await iframe(w).trigger("load");
    const before = iframe(w).element;
    for (const value of ["none", null, "", "nonsense", undefined, 0, false]) {
      await update(w, { audienceTools: value });
    }
    expect(iframe(w).element).toBe(before);
    expect(iframe(w).attributes("allow")).toBe("autoplay");
  });

  it("a meeting that failed to load is reloaded with the new level too", async () => {
    const w = mountTile();
    await iframe(w).trigger("error");
    expect(w.find(".failed").exists()).toBe(true);
    await update(w, { audienceTools: "mic" });
    expect(w.find(".failed").exists()).toBe(false);
    expect(iframe(w).attributes("allow")).toBe("microphone; autoplay");
  });

  it("Refresh streams still reloads an audience meeting, keeping the level", async () => {
    const w = mountTile({ audienceTools: "mic-camera" });
    await iframe(w).trigger("load");
    const before = iframe(w).element;
    store().meetingRefreshKey += 1;
    await nextTick();
    expect(iframe(w).element).not.toBe(before);
    expect(iframe(w).attributes("allow")).toBe("camera; microphone; autoplay");
    expect(modalConfirm).not.toHaveBeenCalled();
  });
});

describe("performer: never touched by the audience-tools setting", () => {
  beforeEach(() => {
    store().canPlay = true;
  });

  it("every change of level leaves the very same iframe, address and permission", async () => {
    const w = mountTile();
    await iframe(w).trigger("load");
    const node = iframe(w).element;
    const src = iframe(w).attributes("src");
    const allow = iframe(w).attributes("allow");
    expect(allow).toBe("camera; microphone; display-capture; autoplay");

    for (const level of ["mic", "mic-camera", "none", "mic", "nonsense", null, "mic-camera"]) {
      await update(w, { audienceTools: level });
      expect(iframe(w).element, String(level)).toBe(node);
      expect(iframe(w).attributes("src"), String(level)).toBe(src);
      expect(iframe(w).attributes("allow"), String(level)).toBe(allow);
      expect(iframe(w).attributes("allowfullscreen"), String(level)).toBe("");
      expect(spinner(w).exists(), String(level)).toBe(false);
    }
    expect(modalConfirm).not.toHaveBeenCalled();
    // And no load timer was restarted behind the performer's back.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);
    expect(w.find(".failed").exists()).toBe(false);
  });

  it("a performer previewing as audience keeps their meeting: same node, no audience tools", async () => {
    // What a watch-only audience iframe is given, for comparison.
    store().canPlay = false;
    const watchOnly = iframe(mountTile());
    const watchOnlySrc = watchOnly.attributes("src");
    store().canPlay = true;

    const w = mountTile({ audienceTools: "mic-camera" });
    await iframe(w).trigger("load");
    const node = iframe(w).element;

    store().canPlay = false; // masquerade on
    await nextTick();
    // Exactly what happened before this feature on a role flip: the address
    // becomes the watch-only one in place, with no reload — and the open
    // level adds nothing, because this iframe was loaded for a performer.
    expect(iframe(w).element).toBe(node);
    expect(iframe(w).attributes("src")).toBe(watchOnlySrc);
    expect(iframe(w).attributes("allow")).toBe("autoplay");

    // Another player changes the level meanwhile: still nothing happens here.
    for (const level of ["mic", "none", "mic-camera"]) {
      await update(w, { audienceTools: level });
      expect(iframe(w).element, level).toBe(node);
      expect(iframe(w).attributes("src"), level).toBe(watchOnlySrc);
      expect(iframe(w).attributes("allow"), level).toBe("autoplay");
    }

    store().canPlay = true; // masquerade off
    await nextTick();
    expect(iframe(w).element).toBe(node);
    expect(iframe(w).attributes("allow")).toBe("camera; microphone; display-capture; autoplay");
  });

  it("the confirmation before reloading a performer's meeting is unchanged", async () => {
    const w = mountTile({ audienceTools: "mic" });
    await iframe(w).trigger("load");
    const node = iframe(w).element;
    store().meetingRefreshKey += 1;
    await nextTick();
    expect(modalConfirm).toHaveBeenCalledTimes(1);
    expect(iframe(w).element).toBe(node);
  });
});

describe("audience member who logs in while a level is open", () => {
  it("gets the performer's address in place, as before; this feature adds no reload", async () => {
    store().canPlay = true;
    const performerSrc = iframe(mountTile()).attributes("src");
    store().canPlay = false;

    const w = mountTile({ audienceTools: "mic" });
    await iframe(w).trigger("load");
    const node = iframe(w).element;

    store().canPlay = true; // logged in from the stage
    await nextTick();
    expect(iframe(w).element).toBe(node);
    expect(iframe(w).attributes("src")).toBe(performerSrc);
    expect(iframe(w).attributes("allow")).toBe("camera; microphone; display-capture; autoplay");
    expect(spinner(w).exists()).toBe(false);

    await update(w, { audienceTools: "mic-camera" });
    expect(iframe(w).element).toBe(node);
    expect(iframe(w).attributes("src")).toBe(performerSrc);
  });
});

describe("replay of a recording", () => {
  it.each(["mic", "mic-camera"])("never opens a microphone (recorded level %s)", async (level) => {
    const watchOnly = iframe(mountTile()).attributes("src");
    const w = mountTile({ audienceTools: level }, { replaying: true });
    expect(iframe(w).attributes("src")).toBe(watchOnly);
    expect(iframe(w).attributes("allow")).toBe("autoplay");
    const node = iframe(w).element;
    await update(w, { audienceTools: level === "mic" ? "mic-camera" : "mic" });
    expect(iframe(w).element).toBe(node);
    expect(iframe(w).attributes("allow")).toBe("autoplay");
  });
});
