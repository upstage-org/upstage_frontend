import { TOPICS } from "@utils/constants";

/**
 * What a session that is NOT performing may publish to a stage.
 *
 * Rule (2026-09): audience sessions must never affect a performance; the
 * only things they contribute are chat text and chat emojis (reactions).
 * Besides those, a non-performing session still has to be COUNTED
 * (presence on `counter`, the retained head-count on `statistics`) and may
 * tell a performer that their stream froze for it (`stream_health`, shown to
 * that performer only). Everything else — the board, backdrop/curtain/scene
 * state, audio, master volume, drawing, and chat MODERATION commands (clear,
 * remove, highlight) — is performance state and is refused.
 *
 * "Not performing" is the stage store's `canPlay === false`: the audience,
 * a player previewing as audience (masquerade), and replay.
 *
 * This is a client-side safeguard against our own code paths (e.g. every
 * client's <audio> `ended` handler used to publish a "stop" for the track).
 * It is not access control: all sessions share one broker login.
 */
const CHAT_MODERATION_KEYS = ["clear", "clearPlayerChat", "remove", "highlight"];

export function audienceMayPublish(topic: string, payload: unknown): boolean {
  switch (topic) {
    case TOPICS.REACTION:
    case TOPICS.COUNTER:
    case TOPICS.STATISTICS:
    case TOPICS.STREAM_HEALTH:
      return true;
    case TOPICS.CHAT:
      // Chat text only. Legacy plain-string chat lines are text too.
      if (typeof payload === "string") return true;
      if (payload == null || typeof payload !== "object") return false;
      return !CHAT_MODERATION_KEYS.some((key) => key in (payload as Record<string, unknown>));
    default:
      return false;
  }
}
