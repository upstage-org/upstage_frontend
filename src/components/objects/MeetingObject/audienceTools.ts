/**
 * Audience tools for an embedded meeting (#1580).
 *
 * The audience watches a meeting and nothing else: their copy of the Jitsi
 * iframe gets an empty toolbar, and — the part that actually binds — the
 * browser is not allowed to hand its camera or microphone to that iframe
 * (`allow="autoplay"`). That is how every meeting has behaved since May
 * 2026 and it remains the default.
 *
 * Meetings are also used for discussions after a show and for workshops,
 * where the audience needs to speak. So a player can now open the meeting
 * up, per meeting, from its right-click menu:
 *
 *   "none"        watch only — exactly as before, to the character
 *   "mic"         the audience gets a microphone button
 *   "mic-camera"  microphone and camera buttons
 *
 * In the two open levels the audience also gets "raise hand" and the
 * tile/speaker view switch. They never get hang-up (leaving stranded them
 * on a Jitsi page inside the frame), settings, invite, chat, screen sharing
 * or any control over other people.
 *
 * Nobody is unmuted by this. Everyone still joins muted, the browser asks
 * for permission the first time a person presses the button, and a player
 * switching the level back closes it again for everyone at once: the
 * audience's iframe is reloaded with the permission withdrawn.
 *
 * The setting is a field on the meeting's board object (`audienceTools`),
 * so it travels and is stored like the object's size or position. It is
 * read ONLY for the audience's copy of the iframe; a performer's meeting is
 * built exactly as before whatever the value is (see `effectiveAudienceTools`).
 *
 * Verified against streaming.upstage.live (Jitsi Meet web 9644, 2026-11-28):
 * the microphone button with `allow="microphone; autoplay"` unmutes and is
 * heard by the others; the same button WITHOUT the permission does nothing.
 */

export const AUDIENCE_TOOLS_LEVELS = ["none", "mic", "mic-camera"] as const;
export type AudienceToolsLevel = (typeof AUDIENCE_TOOLS_LEVELS)[number];

/** Anything that is not one of the two open levels is "none". */
export function normalizeAudienceTools(value: unknown): AudienceToolsLevel {
  return value === "mic" || value === "mic-camera" ? value : "none";
}

/**
 * The level that applies to ONE browser's copy of the meeting iframe.
 *
 * Always "none" — the code path that existed before this feature — when:
 *  - the viewer is a performer (`canPlay`): their meeting is theirs, with
 *    the full Jitsi toolbar;
 *  - the iframe was loaded for a performer, even if they are previewing the
 *    stage as audience right now: nothing about this feature may reach into
 *    a meeting a performer has joined;
 *  - a recording is being replayed: a replay must not offer a live
 *    microphone.
 */
export function effectiveAudienceTools(
  setting: unknown,
  context: { canPlay: boolean; loadedForPerformer: boolean; replaying: boolean },
): AudienceToolsLevel {
  if (context.canPlay || context.loadedForPerformer || context.replaying) return "none";
  return normalizeAudienceTools(setting);
}

export interface AudienceToolsOverrides {
  /** Extra `config.*` values laid over the audience's watch-only set. */
  config: Record<string, unknown>;
  /** Extra `interfaceConfig.*` values (the legacy spelling of the toolbar). */
  interfaceConfig: Record<string, unknown>;
  /** The iframe's `allow` value, or null to keep the watch-only one. */
  allow: string | null;
}

const NO_OVERRIDES: AudienceToolsOverrides = Object.freeze({
  config: Object.freeze({}),
  interfaceConfig: Object.freeze({}),
  allow: null,
});

/** Jitsi toolbar buttons per open level. Hang-up is deliberately absent. */
const BUTTONS: Record<Exclude<AudienceToolsLevel, "none">, readonly string[]> = {
  mic: ["microphone", "raisehand", "tileview"],
  "mic-camera": ["microphone", "camera", "raisehand", "tileview"],
};

/** Browser permissions handed to the audience's iframe per open level. */
const ALLOW: Record<Exclude<AudienceToolsLevel, "none">, string> = {
  mic: "microphone; autoplay",
  "mic-camera": "camera; microphone; autoplay",
};

/**
 * What an open level changes for the audience. "none" changes nothing: the
 * returned objects are empty, so spreading them leaves the watch-only
 * settings untouched.
 */
export function audienceToolsOverrides(level: AudienceToolsLevel): AudienceToolsOverrides {
  if (level !== "mic" && level !== "mic-camera") return NO_OVERRIDES;
  const buttons = [...BUTTONS[level]];
  return {
    config: {
      toolbarButtons: buttons,
      // Someone who can speak can be put on screen for everyone by the
      // moderator ("Everyone follows me"). With the self view off, the
      // person on screen would look at a black picture.
      disableSelfView: false,
    },
    interfaceConfig: { TOOLBAR_BUTTONS: [...buttons] },
    allow: ALLOW[level],
  };
}
