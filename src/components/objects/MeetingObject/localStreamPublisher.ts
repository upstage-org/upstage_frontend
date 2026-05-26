// @ts-nocheck
import { onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { isJitsiBoardType } from "@utils/common";
import { usePageWakeRecovery } from "@composables/usePageWakeRecovery";
import { useLowLevelAPI } from "./composable";

export const blockedReason = (err: unknown): string => {
  const name = err && ((err as Error).name || (err as Error).constructor?.name);
  switch (name) {
    case "NotAllowedError":
      return "Camera/mic permission denied. Allow access in your browser site settings and reload.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone detected. Plug in a device and reload.";
    case "NotReadableError":
    case "TrackStartError":
      return "Camera or microphone is in use by another application. Close it and reload.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "Your device cannot satisfy the requested camera/mic settings.";
    case "SecurityError":
      return "This page must be served over HTTPS for camera/mic access.";
    case "AbortError":
      return "Camera/mic access was cancelled. Reload to try again.";
    default:
      return "Could not start camera/mic. Check browser permissions and reload.";
  }
};

type JitsiRefs = {
  room: {
    myUserId?: () => string;
    addTrack: (t: unknown) => Promise<void>;
    removeTrack: (t: unknown) => Promise<void>;
  } | null;
  localTracks: Ref<unknown[]>;
};

export type LocalStreamPublisherApi = {
  join: () => Promise<void>;
  ensureTracks: () => Promise<void>;
  blocked: Ref<boolean>;
  blockedMessage: Ref<string>;
  pendingPublish: Ref<boolean>;
};

/**
 * Session-scoped local WebRTC track lifecycle.
 *
 * IMPORTANT: must be invoked from Shell.vue (alongside `useJitsi()`) and
 * its API `provide()`d so it reaches `Yourself.vue`. The previous
 * sibling-component design (`<LocalStreamPublisher>` next to
 * `<StageToolbox>` under `<Shell>`) silently broke the inject — sibling
 * components do not see each other's `provide` — so `Yourself.vue#join`
 * was a no-op and `room.addTrack()` was never called. Confirmed via
 * JVB telemetry: `forwardedSources: []`, `bitrate.upload: 0` for every
 * publisher.
 *
 * Takes `jitsi` and `joined` as parameters (rather than `inject`ing
 * them) so the call order from Shell.setup is deterministic — Shell
 * creates both pieces in the same setup and provides everything to
 * descendants in one shot.
 */
export function useLocalStreamPublisher(
  jitsi: JitsiRefs,
  joined: Ref<boolean>,
): LocalStreamPublisherApi {
  const JitsiMeetJS = useLowLevelAPI();
  const stageStore = useStageStore();

  let tracks: unknown[] = [];
  const blocked = ref(false);
  const blockedMessage = ref("");
  const pendingPublish = ref(false);
  const published = ref(false);

  const setBlocked = (message: string) => {
    blocked.value = true;
    blockedMessage.value = message;
  };

  const clearBlocked = () => {
    blocked.value = false;
    blockedMessage.value = "";
  };

  const syncLocalTracksRef = () => {
    if (jitsi?.localTracks) {
      jitsi.localTracks.value = tracks.slice();
    }
  };

  const releaseLocalTracks = () => {
    pendingPublish.value = false;
    published.value = false;
    for (const t of tracks) {
      try {
        (t as { dispose?: () => void }).dispose?.();
      } catch (e) {
        console.warn("Disposing local track:", e);
      }
    }
    tracks = [];
    if (jitsi?.localTracks) {
      jitsi.localTracks.value = [];
    }
  };

  const countOwnJitsiOnBoard = (): number => {
    const myId = jitsi?.room?.myUserId?.();
    if (!myId) return 0;
    return stageStore.board.objects.filter(
      (o) => isJitsiBoardType(o.type) && o.participantId === myId,
    ).length;
  };

  const publishingAllowed = (): boolean =>
    Boolean(stageStore.canPlay) && Boolean(stageStore.enabledLiveStreaming);

  const publishLocalTracksToRoom = async () => {
    if (!joined.value || !jitsi?.room) return;
    for (const t of tracks) {
      try {
        await jitsi.room.addTrack(t);
      } catch (err) {
        console.warn("room.addTrack failed:", err);
        continue;
      }
      stageStore.addTrack(t);
    }
  };

  const tryPublishWhenReady = async (reason: string) => {
    console.log("[diag] localStream.tryPublishWhenReady", {
      reason,
      pendingPublish: pendingPublish.value,
      joined: joined.value,
      hasRoom: !!jitsi?.room,
      tracksLen: tracks.length,
      published: published.value,
    });
    if (!pendingPublish.value) return;
    if (published.value) {
      pendingPublish.value = false;
      return;
    }
    if (!joined.value || !jitsi?.room) return;
    if (tracks.length === 0) return;
    pendingPublish.value = false;
    await publishLocalTracksToRoom();
    published.value = true;
  };

  const acquireLocalTracks = async () => {
    if (!publishingAllowed()) {
      // Audience or live-streaming disabled: never touch the camera.
      // The composable is mounted from Shell for ALL viewers because
      // Shell hosts the jitsi conference object — we just no-op here
      // when the user is not a publisher.
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setBlocked(
        "Camera/mic require an HTTPS connection. Reload this page over https:// and try again.",
      );
      return;
    }

    try {
      const newTracks = await JitsiMeetJS.createLocalTracks({ devices: ["audio", "video"] });
      for (const old of tracks) {
        try {
          (old as { dispose?: () => void }).dispose?.();
        } catch (e) {
          console.warn("Disposing stale local track:", e);
        }
      }
      tracks = [];
      published.value = false;
      if (jitsi?.localTracks) {
        jitsi.localTracks.value = [];
      }

      for (const t of newTracks) {
        tracks.push(t);
      }

      clearBlocked();
      syncLocalTracksRef();
      await tryPublishWhenReady("acquire-resolved");
    } catch (err) {
      console.error("Failed to create local tracks:", err);
      setBlocked(blockedReason(err));
    }
  };

  const republishLocalTracks = async () => {
    if (!joined.value || !jitsi?.room || tracks.length === 0) return;
    for (const t of tracks) {
      try {
        await jitsi.room.removeTrack(t);
      } catch (err) {
        console.warn("room.removeTrack failed:", err);
      }
      try {
        await jitsi.room.addTrack(t);
        stageStore.addTrack(t);
      } catch (err) {
        console.warn("room.addTrack failed:", err);
      }
    }
    syncLocalTracksRef();
  };

  const ensureTracks = async () => {
    if (tracks.length === 0 && !blocked.value) {
      await acquireLocalTracks();
    }
  };

  const join = async () => {
    // Compatibility shim for Yourself.vue's drag/click handlers. The
    // canonical publish trigger is the board-state watcher below
    // (covers first drag + navigate-back with persisted tiles), but
    // we keep this hook so any direct caller still works.
    await ensureTracks();
    pendingPublish.value = true;
    await tryPublishWhenReady("join-action");
  };

  const onDeviceListChanged = () => {
    console.log("Media devices changed; re-acquiring local tracks");
    void acquireLocalTracks();
  };

  const deviceEvents = JitsiMeetJS?.events?.mediaDevices;
  const mediaDevicesAPI = JitsiMeetJS?.mediaDevices;

  onMounted(() => {
    void acquireLocalTracks();
    if (deviceEvents && mediaDevicesAPI?.addEventListener) {
      mediaDevicesAPI.addEventListener(deviceEvents.DEVICE_LIST_CHANGED, onDeviceListChanged);
    }
  });

  // If `canPlay` flips on after mount (e.g. permission upgrades mid-
  // session, or `loadStage` resolves asynchronously), kick the
  // acquire path again so we don't sit in a silent unconfigured state.
  watch(
    () => publishingAllowed(),
    (allowed, prev) => {
      if (allowed && !prev) {
        void acquireLocalTracks();
      } else if (!allowed && prev) {
        releaseLocalTracks();
      }
    },
  );

  usePageWakeRecovery(() => {
    if (joined.value && tracks.length > 0) {
      void acquireLocalTracks();
    }
  });

  watch(
    () => stageStore.reloadStreams,
    (tick) => {
      if (tick) void republishLocalTracks();
    },
  );

  watch(joined, async (isJoined) => {
    if (isJoined) {
      // Conference is back online — if a persisted own-tile is already
      // on the board, kick the canonical board-driven publish.
      if (publishingAllowed() && countOwnJitsiOnBoard() > 0 && !published.value) {
        pendingPublish.value = true;
      }
      await tryPublishWhenReady("joined-watch");
    }
  });

  // Board-state watcher: the canonical signal for "publisher should
  // publish" is "an own-jitsi tile exists on the board". This covers:
  //   * first drag from the Yourself preview (Yourself.vue calls
  //     placeObjectOnStage which appends a tile),
  //   * navigate-back with persisted tiles (loadStage replays events
  //     and re-populates board.objects),
  //   * programmatic placement (tests, future flows).
  // The previous `pendingPublish`-only design required Yourself.vue to
  // explicitly call publisher.join(), which silently broke when the
  // inject chain regressed. Driving off the board removes that gap.
  let prevOwnJitsiCount = 0;
  watch(
    () => countOwnJitsiOnBoard(),
    (count) => {
      if (stageStore.status !== "LIVE") {
        prevOwnJitsiCount = count;
        return;
      }
      if (prevOwnJitsiCount > 0 && count === 0) {
        releaseLocalTracks();
      } else if (count > 0 && !published.value && publishingAllowed()) {
        pendingPublish.value = true;
        void tryPublishWhenReady("own-jitsi-on-board");
      }
      prevOwnJitsiCount = count;
    },
    { immediate: true },
  );

  // NOTE: there is deliberately NO watcher on `stageStore.status` here.
  //
  // `stageStore.status` reflects the **MQTT** broker connection
  // ("OFFLINE"/"CONNECTING"/"LIVE") and is independent of the Jitsi
  // conference health (which is `joined.value`). MQTT.js auto-reconnects
  // on idle timeouts, network blips, mobile network handoff, etc., and
  // every reconnect flips `status` to "CONNECTING" before settling back
  // to "LIVE". A previous version of this file disposed local tracks on
  // any non-"LIVE" status transition — which silently tore down the
  // performer's published WebRTC tracks on every MQTT keepalive bounce,
  // stopping outgoing RTP. The audience side then saw the on-stage
  // <Jitsi> tile but never received frames, and the refresh-streams
  // button was a no-op because `republishLocalTracks()` short-circuits
  // on `tracks.length === 0`. WebRTC track lifecycle must NOT be tied
  // to MQTT status. The legitimate release paths are already covered:
  //   * `onUnmounted` below (route teardown).
  //   * The `publishingAllowed` watcher (canPlay / enabledLiveStreaming
  //     flipping off mid-session).
  //   * The board-state watcher above (own-jitsi tile removed from board).

  onUnmounted(() => {
    if (deviceEvents && mediaDevicesAPI?.removeEventListener) {
      mediaDevicesAPI.removeEventListener(deviceEvents.DEVICE_LIST_CHANGED, onDeviceListChanged);
    }
    releaseLocalTracks();
  });

  return {
    join,
    ensureTracks,
    blocked,
    blockedMessage,
    pendingPublish,
  };
}
