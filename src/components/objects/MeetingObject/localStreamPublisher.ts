// @ts-nocheck
import { inject, onMounted, onUnmounted, ref, watch, type Ref } from "vue";
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

export type LocalStreamPublisherApi = {
  join: () => Promise<void>;
  ensureTracks: () => Promise<void>;
  blocked: Ref<boolean>;
  blockedMessage: Ref<string>;
  pendingPublish: Ref<boolean>;
};

/**
 * Session-scoped local WebRTC track lifecycle. Mounted from Layout via
 * LocalStreamPublisher.vue so closing the Meeting toolbox does not dispose
 * tracks while jitsi tiles remain on the board.
 */
export function useLocalStreamPublisher(): LocalStreamPublisherApi {
  const jitsi = inject("jitsi") as {
    room: { myUserId?: () => string; addTrack: (t: unknown) => Promise<void>; removeTrack: (t: unknown) => Promise<void> } | null;
    localTracks: Ref<unknown[]>;
  };
  const joined = inject("joined") as Ref<boolean>;
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
      await tryPublishWhenReady("joined-watch");
    }
  });

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
      }
      prevOwnJitsiCount = count;
    },
    { immediate: true },
  );

  watch(
    () => stageStore.status,
    (status) => {
      if (status !== "LIVE") {
        releaseLocalTracks();
      }
    },
  );

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
