import { BACKGROUND_ACTIONS, BOARD_ACTIONS, TOPICS } from "@utils/constants";
import { isJitsiBoardType } from "@utils/common";
import { unnamespaceTopic } from "@utils/mqttTopics";
import type { BoardObject, ObjectId, ReplayEvent } from "@stores/pinia/stage";

/** Minimal shape of an archived board event payload we need to reconcile. */
interface BoardMessage {
  type: string;
  object?: BoardObject;
}

/** A scene change in the archive, as far as the jitsi reconcile cares. */
type SceneChange = { kind: "blank" } | { kind: "switch"; scene: ObjectId };

/** Parse an archive event into a scene change (null if it is not one). */
export function sceneChangeFromEvent(event: ReplayEvent): SceneChange | null {
  if (unnamespaceTopic(event.topic ?? "") !== TOPICS.BACKGROUND) return null;
  const raw = event.payload;
  if (raw == null) return null;
  let msg: { type?: string; scene?: ObjectId };
  try {
    msg = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (msg?.type === BACKGROUND_ACTIONS.BLANK_SCENE) return { kind: "blank" };
  if (msg?.type === BACKGROUND_ACTIONS.SWITCH_SCENE && msg.scene !== undefined) {
    return { kind: "switch", scene: msg.scene };
  }
  return null;
}

export interface JitsiReconcileOptions {
  /**
   * The jitsi tiles (wire form, as in a PLACE payload) that a saved scene
   * puts on the stage, or `null` when the scene is unknown / has no board —
   * in which case switching to it changed nothing on the live clients either.
   */
  sceneJitsiTiles?: (sceneId: ObjectId) => BoardObject[] | null;
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
  /**
   * Every jitsi tile id the archive has ever heard of (PLACE, MOVE_TO or
   * DESTROY). A tile on a board that is NOT in here was never announced, so
   * the archive has no say over it — see reconcileJitsiBoardFromEvents.
   */
  seenIds: ObjectId[];
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
 *
 * Scene changes count too. Switching scene (or the blank scene) replaces the
 * whole board on every live client, so a stream tile that was on stage before
 * the switch is gone afterwards — without any DESTROY event. Ignoring that,
 * the archive kept saying "PLACE, never destroyed", and every later reconcile
 * (stage load, MQTT reconnect) put the tile back as a ghost: on stage for the
 * clients that reconciled, not for the others, bound to a stream that was no
 * longer published. After a switch the stage holds exactly the jitsi tiles the
 * scene carries (`options.sceneJitsiTiles`); after the blank scene, none.
 */
export function computeFinalJitsiObjectsFromEvents(
  events: ReplayEvent[],
  options: JitsiReconcileOptions = {},
): JitsiReconcileResult {
  const byId = new Map<ObjectId, BoardObject>();
  const destroyedIds: ObjectId[] = [];
  const seenIds = new Set<ObjectId>();
  const hostLatestPid = new Map<string, string>();
  const sorted = [...events].sort((a, b) => (a.mqttTimestamp ?? 0) - (b.mqttTimestamp ?? 0));
  const noteGeneration = (object: BoardObject) => {
    const host = object.hostId != null ? String(object.hostId) : null;
    const pid = object.participantId != null ? String(object.participantId) : null;
    // Events are timestamp-sorted, so the last write wins = current generation.
    if (host && pid) hostLatestPid.set(host, pid);
  };
  for (const event of sorted) {
    const sceneChange = sceneChangeFromEvent(event);
    if (sceneChange) {
      if (sceneChange.kind === "blank") {
        byId.clear();
      } else {
        const sceneTiles = options.sceneJitsiTiles?.(sceneChange.scene) ?? null;
        // Unknown scene: the live clients applied nothing, so neither do we.
        if (sceneTiles) {
          byId.clear();
          for (const tile of sceneTiles) {
            if (tile?.id == null || !isJitsiBoardType(tile.type)) continue;
            const placed = { ...tile, liveAction: true, published: true };
            byId.set(tile.id, placed);
            seenIds.add(tile.id);
            noteGeneration(placed);
          }
        }
      }
      continue;
    }
    const msg = boardMessageFromEvent(event);
    if (!msg?.object?.id || !isJitsiBoardType(msg.object.type)) continue;
    const { id } = msg.object;
    seenIds.add(id);
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
  return { tiles, destroyedIds, seenIds: [...seenIds] };
}
