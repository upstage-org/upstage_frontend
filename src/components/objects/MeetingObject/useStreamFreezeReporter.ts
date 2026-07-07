import { onUnmounted, watch, type Ref } from "vue";
import { useStageStore } from "@stores/pinia/stage";

/**
 * Viewer side of the stream-freeze feature: when this viewer's video of a
 * REMOTE performer's stream freezes (per `useStreamFreezeDetector`), report it
 * to that performer over MQTT so the performer can show a "frozen for N
 * viewers" indicator.
 *
 * - No-op for our OWN tiles (`hostId === session`) — we never report freezes of
 *   a stream we are publishing.
 * - While frozen, a heartbeat re-sends the report every `HEARTBEAT_MS` so a
 *   dropped "recovered" message or a viewer that simply closes the tab
 *   self-heals via the performer's ageout pruner.
 * - On recovery (frozen → false) a single `frozen: false` message is sent so
 *   the count drops immediately.
 *
 * `getObject` returns the reactive board object (carries `hostId` = publisher's
 * session, `id`, `participantId`). The store action `reportStreamHealth` stamps
 * `viewerSession` + `at` and publishes.
 */

const HEARTBEAT_MS = 4000;

export function useStreamFreezeReporter(
  getObject: () => { id?: unknown; hostId?: unknown; participantId?: unknown } | undefined,
  frozen: Ref<boolean>,
) {
  const stageStore = useStageStore();

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reportedFrozen = false;

  const isOwnTile = (): boolean => {
    const obj = getObject();
    return !obj || obj.hostId === stageStore.session;
  };

  const publish = (isFrozen: boolean) => {
    const obj = getObject();
    if (!obj) return;
    stageStore.reportStreamHealth({
      hostId: obj.hostId,
      objectId: obj.id,
      participantId: obj.participantId,
      frozen: isFrozen,
    });
  };

  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  watch(frozen, (isFrozen) => {
    // Never report freezes of our own published stream.
    if (isOwnTile()) return;
    if (isFrozen) {
      reportedFrozen = true;
      publish(true);
      if (!heartbeat) heartbeat = setInterval(() => publish(true), HEARTBEAT_MS);
    } else {
      stopHeartbeat();
      if (reportedFrozen) {
        reportedFrozen = false;
        publish(false);
      }
    }
  });

  onUnmounted(() => {
    stopHeartbeat();
    // If we unmount while still frozen, send a best-effort recovery so the
    // performer's count drops without waiting for the ageout pruner.
    if (reportedFrozen && !isOwnTile()) {
      publish(false);
    }
  });
}
