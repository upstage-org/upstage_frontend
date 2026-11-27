import { describe, expect, it } from "vitest";
import {
  AUDIENCE_TOOLS_LEVELS,
  audienceToolsOverrides,
  effectiveAudienceTools,
  normalizeAudienceTools,
} from "./audienceTools";

/**
 * Audience tools for an embedded meeting (#1580): the pure rules. Which
 * values count, who they apply to, and exactly what an open level adds for
 * the audience — and that "off" adds nothing.
 */

describe("normalizeAudienceTools", () => {
  it("knows exactly three levels", () => {
    expect([...AUDIENCE_TOOLS_LEVELS]).toEqual(["none", "mic", "mic-camera"]);
  });

  it.each(["mic", "mic-camera"] as const)("keeps the open level %s", (level) => {
    expect(normalizeAudienceTools(level)).toBe(level);
  });

  it.each([
    undefined,
    null,
    "",
    "none",
    "MIC",
    "Mic",
    " mic",
    "mic ",
    "camera",
    "mic+camera",
    "mic_camera",
    "all",
    "true",
    true,
    false,
    0,
    1,
    {},
    { level: "mic" },
    [],
    ["mic"],
    () => "mic",
    Symbol("mic"),
  ])("treats %o as off", (value) => {
    expect(normalizeAudienceTools(value)).toBe("none");
  });
});

describe("effectiveAudienceTools: who an open level applies to", () => {
  const audience = { canPlay: false, loadedForPerformer: false, replaying: false };

  it("an audience member gets the level the players chose", () => {
    expect(effectiveAudienceTools("mic", audience)).toBe("mic");
    expect(effectiveAudienceTools("mic-camera", audience)).toBe("mic-camera");
    expect(effectiveAudienceTools(undefined, audience)).toBe("none");
    expect(effectiveAudienceTools("nonsense", audience)).toBe("none");
  });

  it.each(["mic", "mic-camera", "none", undefined, "nonsense"])(
    "a performer is never governed by it (setting %s)",
    (setting) => {
      expect(effectiveAudienceTools(setting, { ...audience, canPlay: true })).toBe("none");
      expect(
        effectiveAudienceTools(setting, { ...audience, canPlay: true, loadedForPerformer: true }),
      ).toBe("none");
    },
  );

  it("an iframe loaded for a performer stays out of it while they preview as audience", () => {
    expect(effectiveAudienceTools("mic-camera", { ...audience, loadedForPerformer: true })).toBe(
      "none",
    );
  });

  it("a replay never offers a live microphone", () => {
    expect(effectiveAudienceTools("mic", { ...audience, replaying: true })).toBe("none");
    expect(effectiveAudienceTools("mic-camera", { ...audience, replaying: true })).toBe("none");
  });

  it("every combination with a performer, a performer's iframe or a replay is off", () => {
    for (const setting of ["mic", "mic-camera"]) {
      for (const canPlay of [true, false]) {
        for (const loadedForPerformer of [true, false]) {
          for (const replaying of [true, false]) {
            const expected = canPlay || loadedForPerformer || replaying ? "none" : setting;
            expect(
              effectiveAudienceTools(setting, { canPlay, loadedForPerformer, replaying }),
              JSON.stringify({ setting, canPlay, loadedForPerformer, replaying }),
            ).toBe(expected);
          }
        }
      }
    }
  });
});

describe("audienceToolsOverrides: what an open level adds", () => {
  it("off adds nothing at all", () => {
    const off = audienceToolsOverrides("none");
    expect(off.config).toEqual({});
    expect(off.interfaceConfig).toEqual({});
    expect(off.allow).toBeNull();
    expect(Object.keys({ a: 1, ...off.config })).toEqual(["a"]);
  });

  it("an unknown level adds nothing either (defence in depth)", () => {
    const off = audienceToolsOverrides("everything" as never);
    expect(off.config).toEqual({});
    expect(off.allow).toBeNull();
  });

  it("microphone: mic button, raise hand, view switch; microphone permission only", () => {
    const o = audienceToolsOverrides("mic");
    expect(o.config).toEqual({
      toolbarButtons: ["microphone", "raisehand", "tileview"],
      disableSelfView: false,
    });
    expect(o.interfaceConfig).toEqual({
      TOOLBAR_BUTTONS: ["microphone", "raisehand", "tileview"],
    });
    expect(o.allow).toBe("microphone; autoplay");
  });

  it("microphone + camera: adds the camera button and the camera permission", () => {
    const o = audienceToolsOverrides("mic-camera");
    expect(o.config).toEqual({
      toolbarButtons: ["microphone", "camera", "raisehand", "tileview"],
      disableSelfView: false,
    });
    expect(o.interfaceConfig).toEqual({
      TOOLBAR_BUTTONS: ["microphone", "camera", "raisehand", "tileview"],
    });
    expect(o.allow).toBe("camera; microphone; autoplay");
  });

  it.each(["mic", "mic-camera"] as const)(
    "%s never includes hang-up, settings, sharing, chat or control over others",
    (level) => {
      const o = audienceToolsOverrides(level);
      const buttons = o.config.toolbarButtons as string[];
      for (const forbidden of [
        "hangup",
        "settings",
        "desktop",
        "chat",
        "invite",
        "participants-pane",
        "security",
        "recording",
        "livestreaming",
        "sharedvideo",
        "fullscreen",
        "profile",
        "select-background",
        "mute-everyone",
        "mute-video-everyone",
        "embedmeeting",
        "etherpad",
        "whiteboard",
        "closedcaptions",
      ]) {
        expect(buttons).not.toContain(forbidden);
      }
      // Screen sharing is never delegated to the audience's iframe.
      expect(o.allow).not.toContain("display-capture");
      expect(o.allow).toContain("autoplay");
      // Only these keys are touched; every other watch-only setting stands.
      expect(Object.keys(o.config).sort()).toEqual(["disableSelfView", "toolbarButtons"]);
      expect(Object.keys(o.interfaceConfig)).toEqual(["TOOLBAR_BUTTONS"]);
    },
  );

  it("camera is only ever granted together with the camera button", () => {
    expect(audienceToolsOverrides("mic").allow).not.toContain("camera");
    expect(audienceToolsOverrides("mic").config.toolbarButtons).not.toContain("camera");
  });

  it("returns fresh arrays, so one caller cannot alter the next one's toolbar", () => {
    const first = audienceToolsOverrides("mic");
    (first.config.toolbarButtons as string[]).push("hangup");
    (first.interfaceConfig.TOOLBAR_BUTTONS as string[]).push("hangup");
    const second = audienceToolsOverrides("mic");
    expect(second.config.toolbarButtons).toEqual(["microphone", "raisehand", "tileview"]);
    expect(second.interfaceConfig.TOOLBAR_BUTTONS).toEqual(["microphone", "raisehand", "tileview"]);
  });

  it("the shared 'nothing' result cannot be modified", () => {
    const off = audienceToolsOverrides("none");
    expect(() => {
      (off.config as Record<string, unknown>).toolbarButtons = ["hangup"];
    }).toThrow();
    expect(audienceToolsOverrides("none").config).toEqual({});
  });
});
