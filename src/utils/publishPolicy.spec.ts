import { describe, expect, it } from "vitest";
import { TOPICS } from "@utils/constants";
import { audienceMayPublish } from "./publishPolicy";

/**
 * Rule (2026-09): audience sessions must never affect a performance — the
 * only things they contribute are chat text and chat emojis (reactions).
 */
describe("audienceMayPublish", () => {
  it("allows chat text", () => {
    expect(audienceMayPublish(TOPICS.CHAT, { user: "guest", message: "bravo!", id: "1" })).toBe(
      true,
    );
    expect(audienceMayPublish(TOPICS.CHAT, "legacy plain text")).toBe(true);
  });

  it("allows reactions (chat emojis)", () => {
    expect(audienceMayPublish(TOPICS.REACTION, "👏")).toBe(true);
  });

  it("allows being counted and reporting a frozen stream to its performer", () => {
    expect(audienceMayPublish(TOPICS.COUNTER, { id: "s1", isPlayer: false })).toBe(true);
    expect(audienceMayPublish(TOPICS.STATISTICS, { players: 1, audiences: 3 })).toBe(true);
    expect(audienceMayPublish(TOPICS.STREAM_HEALTH, { hostId: "p1", frozen: true })).toBe(true);
  });

  it.each([TOPICS.BOARD, TOPICS.BACKGROUND, TOPICS.AUDIO, TOPICS.AUDIO_MASTER, TOPICS.DRAW])(
    "refuses performance state on %s",
    (topic) => {
      expect(audienceMayPublish(topic, { anything: true })).toBe(false);
    },
  );

  it.each([{ clear: true }, { clearPlayerChat: true }, { remove: "m1" }, { highlight: "m1" }])(
    "refuses chat moderation %o",
    (payload) => {
      expect(audienceMayPublish(TOPICS.CHAT, payload)).toBe(false);
    },
  );

  it("refuses unknown topics and malformed chat payloads", () => {
    expect(audienceMayPublish("something_new", {})).toBe(false);
    expect(audienceMayPublish(TOPICS.CHAT, null)).toBe(false);
    expect(audienceMayPublish(TOPICS.CHAT, 42)).toBe(false);
  });

  it("covers every topic the app knows (a new topic must be classified here)", () => {
    const allowed = Object.values(TOPICS).filter((t) => audienceMayPublish(t, { message: "x" }));
    expect(allowed.sort()).toEqual(
      [
        TOPICS.CHAT,
        TOPICS.COUNTER,
        TOPICS.REACTION,
        TOPICS.STATISTICS,
        TOPICS.STREAM_HEALTH,
      ].sort(),
    );
  });
});
