import { BOARD_ACTIONS, TOPICS } from "@utils/constants";
import { isJitsiBoardType } from "@utils/common";
import { unnamespaceTopic } from "@utils/mqttTopics";
import type { BoardObject, ObjectId, ReplayEvent } from "@stores/pinia/stage";

/** Minimal shape of an archived board event payload we need to reconcile. */
interface BoardMessage {
  type: string;
  object?: BoardObject;
}

/** Parse a replay/archive event into a board message (null if not a board topic). */
export function boardMessageFromEvent(event: ReplayEvent): BoardMessage | null {
  if (unnamespaceTopic(event.topic ?? "") !== TOPICS.BOARD) return null;
  const raw = event.payload;
  if (raw == null) return null;
  return (typeof raw === "string" ? JSON.parse(raw) : { ...raw }) as BoardMessage;
}

export interface JitsiReconcileResult {
  /** The authoritative set of currently-live jitsi tiles. */
  tiles: BoardObject[];
  /** Ids seen in a DESTROY event — caller drops these from any pending state. */
  destroyedIds: ObjectId[];
}

/**
 * Derive the authoritative set of jitsi tiles from archived board events.
 * Applies PLACE / MOVE_TO / DESTROY in timestamp order, then drops ghost
 * tiles by *generation* rather than by tab.
 *
 * lib-jitsi-meet mints a fresh `participantId` (myUserId) on every
 * CONFERENCE_JOINED, and the publisher re-stamps + re-broadcasts every own tile
 * with the current id on each (re)join. So the authoritative "current
 * generation" for a publishing tab (`hostId`) is the latest `participantId` it
 * broadcast. A tile carrying an OLDER participantId than its host's latest is a
 * leftover from a previous join whose heal/DESTROY never reached the archive —
 * drop it. Tiles sharing the CURRENT participantId are concurrent live streams
 * (a performer may publish several stream tiles from one tab at once) and must
 * ALL survive — keying the de-dup on `hostId` alone collapsed those down to one.
 */
export function computeFinalJitsiObjectsFromEvents(events: ReplayEvent[]): JitsiReconcileResult {
  const byId = new Map<ObjectId, BoardObject>();
  const destroyedIds: ObjectId[] = [];
  const hostLatestPid = new Map<string, string>();
  const sorted = [...events].sort((a, b) => (a.mqttTimestamp ?? 0) - (b.mqttTimestamp ?? 0));
  const noteGeneration = (object: BoardObject) => {
    const host = object.hostId != null ? String(object.hostId) : null;
    const pid = object.participantId != null ? String(object.participantId) : null;
    // Events are timestamp-sorted, so the last write wins = current generation.
    if (host && pid) hostLatestPid.set(host, pid);
  };
  for (const event of sorted) {
    const msg = boardMessageFromEvent(event);
    if (!msg?.object?.id || !isJitsiBoardType(msg.object.type)) continue;
    const { id } = msg.object;
    switch (msg.type) {
      case BOARD_ACTIONS.DESTROY:
        byId.delete(id);
        destroyedIds.push(id);
        break;
      case BOARD_ACTIONS.PLACE_OBJECT_ON_STAGE: {
        const placed = { ...msg.object, liveAction: true, published: true };
        byId.set(id, placed);
        noteGeneration(placed);
        break;
      }
      case BOARD_ACTIONS.MOVE_TO: {
        const prev = byId.get(id);
        if (prev) {
          const merged = { ...prev, ...msg.object };
          byId.set(id, merged);
          noteGeneration(merged);
        }
        break;
      }
      default:
        break;
    }
  }
  const tiles = [...byId.values()].filter((o) => {
    const host = o.hostId != null ? String(o.hostId) : null;
    const pid = o.participantId != null ? String(o.participantId) : null;
    // Keep tiles with no host/participant binding (legacy data) and every tile
    // on the current generation; drop only stale prior-join ghosts.
    if (!host || !pid) return true;
    const latest = hostLatestPid.get(host);
    return latest == null || latest === pid;
  });
  return { tiles, destroyedIds };
}
