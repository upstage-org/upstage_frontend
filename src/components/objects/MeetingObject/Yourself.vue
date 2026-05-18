<script>
import Skeleton from "components/stage/Toolboxs/Skeleton.vue";
import { computed, inject, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useUserStore } from "@stores/pinia/user";
import { useStageStore } from "@stores/pinia/stage";
import { useLowLevelAPI } from "./composable";

// Map a `getUserMedia` DOMException name to a short, performer-facing
// message. Each browser raises a different name for the same condition;
// presenting the raw name (or just hiding the avatar with no
// explanation, as the previous code did) leaves the performer guessing.
//
//  - NotAllowedError    : permission denied (also Firefox secure-context
//                         failure)
//  - NotFoundError      : no camera / no microphone connected
//  - NotReadableError   : device claimed by another app (Zoom / OBS / OS)
//  - OverconstrainedError : requested constraints can't be satisfied
//  - SecurityError      : Firefox's "served over plain HTTP" rejection
//  - AbortError         : user closed the permission prompt
const blockedReason = (err) => {
  const name = err && (err.name || err.constructor?.name);
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

export default {
  components: { Skeleton },
  setup() {
    let tracks = [];
    const el = ref();
    const blocked = ref(false);
    const blockedMessage = ref("");
    const loading = ref(true);
    const data = reactive({
      type: "jitsi",
      participantId: null,
      w: 100,
      h: 100,
      volume: 50,
    });

    const jitsi = inject("jitsi");
    const joined = inject("joined");
    const JitsiMeetJS = useLowLevelAPI();
    const stageStore = useStageStore();
    /**
     * Set when the user has signalled intent to publish (drag from the
     * Yourself preview, or click the preview <video>). Cleared once the
     * tracks have actually been pushed into the room, OR on unmount.
     *
     * Required because the user can request publish *before* either of
     * the two async preconditions is satisfied:
     *
     *   (a) CONFERENCE_JOINED has fired (`joined.value === true`), and
     *   (b) `createLocalTracks` has resolved (`tracks.length > 0`).
     *
     * The previous code only gated on (a) via `pendingPublish`. If the
     * user dragged after (a) but before (b) — typical when the browser
     * permission prompt takes a couple of seconds on Brave/Safari — the
     * `for (const t of tracks)` loop in `publishLocalTracksToRoom`
     * iterated an empty array, no `addTrack` was called, no TRACK_ADDED
     * fired, and the on-stage tile span forever with `tracksLen: 0`.
     */
    const pendingPublish = ref(false);
    /**
     * Set once the current set of `tracks` has been pushed into the
     * conference. Re-cleared by `acquireLocalTracks` when it acquires a
     * *new* set of tracks (DEVICE_LIST_CHANGED hot-swap), so the
     * replacement tracks get published when the user next drags.
     *
     * Without this, a second drag (or back-to-back wake-ups from
     * `joined` / `acquireLocalTracks`) would re-enter
     * `publishLocalTracksToRoom` with the same `tracks` array and call
     * `room.addTrack(t)` on tracks the conference already has.
     * lib-jitsi-meet rejects that (or no-ops with a warning depending
     * on version), which is harmless but noisy.
     */
    const published = ref(false);

    const setBlocked = (message) => {
      blocked.value = true;
      blockedMessage.value = message;
      loading.value = false;
    };

    // Acquire local audio + video tracks. Extracted into a named function
    // so we can re-invoke it from the DEVICE_LIST_CHANGED handler when
    // the user hot-swaps a webcam / headset (Chrome handles this OK on
    // its own; Safari typically does not, leaving the stream silently
    // dead until reload).
    const acquireLocalTracks = async () => {
      // HTTPS preflight. `getUserMedia` requires a secure context on every
      // major browser; serving the SPA over plain HTTP from anything other
      // than `localhost` makes the call reject with `NotAllowedError`
      // (Chromium) or `SecurityError` (Firefox), with no actionable hint
      // to the performer. Short-circuit with a clear message instead.
      if (typeof window !== "undefined" && !window.isSecureContext) {
        setBlocked(
          "Camera/mic require an HTTPS connection. Reload this page over https:// and try again.",
        );
        return;
      }

      try {
        const newTracks = await JitsiMeetJS.createLocalTracks({ devices: ["audio", "video"] });
        // Dispose of any prior tracks so re-acquiring after a device
        // change doesn't leak the previous MediaStream.
        for (const old of tracks) {
          try {
            old.dispose?.();
          } catch (e) {
            console.warn("Disposing stale local track:", e);
          }
        }
        tracks = [];
        // Tracks are being replaced (initial acquire or hot-swap via
        // DEVICE_LIST_CHANGED). Reset `published` so the new set gets
        // pushed into the room on the next `tryPublishWhenReady`.
        published.value = false;
        // Clear the previous set from the shared composable ref so
        // any on-stage own-tile bound to the old MediaStream detaches
        // before we publish the new one below.
        if (jitsi?.localTracks) {
          jitsi.localTracks.value = [];
        }

        for (const t of newTracks) {
          tracks.push(t);
          if (t.type === "video") {
            t.attach(el.value);

            if (el.value) {
              el.value.disablePictureInPicture = true;

              el.value.addEventListener("enterpictureinpicture", (e) => {
                e.preventDefault();
                console.log("Picture-in-Picture suppressed for self-preview");
              });

              // Safari (desktop and iOS) blocks autoplay on a <video>
              // bound to a MediaStream that has any unmuted audio track,
              // even via srcObject. We already render `muted` in the
              // template (a self-preview must not echo your own voice
              // back), but we also call play() defensively here:
              //  - In Chromium / Firefox this is a no-op (already
              //    autoplaying).
              //  - In Safari, if anything still rejects (e.g. user
              //    disabled autoplay site-wide), we surface it instead
              //    of leaving `loading.value` stuck at true forever.
              const playPromise = el.value.play();
              if (playPromise && typeof playPromise.catch === "function") {
                playPromise.catch((err) => {
                  console.warn("Local preview autoplay was blocked:", err);
                  loading.value = false;
                });
              }
            }

            el.value.addEventListener("loadedmetadata", () => {
              const width = el.value.videoWidth;
              const height = el.value.videoHeight;
              data.w = (100 * width) / height;
              data.h = 100;
            });
          }
        }
        // Acquisition succeeded — clear any prior blocked flag.
        blocked.value = false;
        blockedMessage.value = "";

        // Publish the freshly-acquired tracks into the shared
        // composable ref so `Jitsi.vue`'s own-tile branch can render
        // them immediately, independently of conference join. This is
        // the path that lets the performer see their own dragged
        // stream even when `room.addTrack()` is still waiting on (or
        // permanently blocked by) a stuck `CONFERENCE_JOINED`.
        if (jitsi?.localTracks) {
          jitsi.localTracks.value = tracks.slice();
        }

        // If the user already requested publish (dragged the preview
        // before the camera prompt resolved), `pendingPublish` is true
        // and the joined-watch's earlier attempt was a no-op because
        // `tracks` was still empty. Drive the publish from this side
        // too so whichever of (joined, tracks-acquired) lands second
        // wakes up the publish.
        await tryPublishWhenReady("acquire-resolved");
      } catch (err) {
        console.error("Failed to create local tracks:", err);
        setBlocked(blockedReason(err));
      }
    };

    onMounted(() => {
      acquireLocalTracks();
    });

    // Subscribe to device-list changes (camera/mic plugged in or removed,
    // OS default changed, Bluetooth headset connected/disconnected) and
    // re-acquire local tracks. Without this, Safari users hot-swapping a
    // headset go silent until they reload the page; Chromium handles it
    // mostly internally but still benefits from explicit re-acquire so
    // the visible preview stays in sync.
    const onDeviceListChanged = () => {
      console.log("Media devices changed; re-acquiring local tracks");
      acquireLocalTracks();
    };
    const deviceEvents = JitsiMeetJS?.events?.mediaDevices;
    const mediaDevicesAPI = JitsiMeetJS?.mediaDevices;
    if (deviceEvents && mediaDevicesAPI?.addEventListener) {
      mediaDevicesAPI.addEventListener(deviceEvents.DEVICE_LIST_CHANGED, onDeviceListChanged);
    }

    onUnmounted(() => {
      pendingPublish.value = false;
      if (deviceEvents && mediaDevicesAPI?.removeEventListener) {
        mediaDevicesAPI.removeEventListener(deviceEvents.DEVICE_LIST_CHANGED, onDeviceListChanged);
      }
      // Release the camera/mic when the component is torn down so the
      // hardware indicator turns off and other apps can use the device.
      for (const t of tracks) {
        try {
          t.dispose?.();
        } catch (e) {
          console.warn("Disposing local track on unmount:", e);
        }
      }
      tracks = [];
      // Clear the shared composable ref so any still-mounted on-stage
      // own-tile drops its now-disposed track reference and re-renders
      // the loading branch instead of holding onto an inert
      // MediaStream.
      if (jitsi?.localTracks) {
        jitsi.localTracks.value = [];
      }
    });

    watch(joined, () => (data.participantId = jitsi.room?.myUserId()), {
      immediate: true,
    });

    const publishLocalTracksToRoom = async () => {
      console.log("[diag] Yourself.publishLocalTracksToRoom enter", {
        joined: joined.value,
        hasRoom: !!jitsi.room,
        tracksLen: tracks.length,
        trackTypes: tracks.map((t) => t.type),
        published: published.value,
      });
      if (!joined.value || !jitsi.room) return;
      for (const t of tracks) {
        try {
          // room.addTrack returns a Promise that resolves once
          // lib-jitsi-meet has registered the track on the local
          // conference and assigned it a participantId. Awaiting here
          // means the subsequent stageStore.addTrack(t) — and the
          // canonical TRACK_ADDED event the conference emits — both
          // publish a track whose getParticipantId() already returns
          // the local user id, so Jitsi.vue's per-participantId filter
          // matches immediately instead of caching an "early,
          // ownerless" entry that never re-evaluates (Vue cannot track
          // a JS method call on a non-reactive JitsiTrack).
          await jitsi.room.addTrack(t);
        } catch (err) {
          console.warn("room.addTrack failed:", err);
          continue;
        }
        // Local conferences in lib-jitsi-meet do not reliably emit
        // TRACK_ADDED for tracks the local user added themselves; the
        // event fires on remote peers' conferences as the SSRC
        // propagates over RTC, but not on this conference. Push the
        // local track into the stage store directly so this user's own
        // on-stage <Jitsi> tile finds it via the participantId filter
        // and can render. ADD_TRACK re-places by JitsiTrack.getId(), so
        // this is safe if a future lib-jitsi-meet does also emit
        // TRACK_ADDED for the local conference (the republish will
        // simply swap in the same JitsiTrack reference).
        stageStore.addTrack(t);
      }
    };

    /**
     * Single chokepoint that publishes iff *both* async preconditions
     * have landed. Called from three places that may each be the last
     * to flip a precondition:
     *   - `join()`             (user dragged / clicked the preview)
     *   - `joined` watcher     (CONFERENCE_JOINED fired)
     *   - `acquireLocalTracks` (camera permission resolved)
     *
     * Clears `pendingPublish` synchronously *before* the awaited
     * `publishLocalTracksToRoom` so a second wake-up while the first is
     * still in-flight cannot double-publish the same tracks. `published`
     * gates subsequent wake-ups after the publish has completed.
     */
    const tryPublishWhenReady = async (reason) => {
      console.log("[diag] Yourself.tryPublishWhenReady", {
        reason,
        pendingPublish: pendingPublish.value,
        joined: joined.value,
        hasRoom: !!jitsi.room,
        tracksLen: tracks.length,
        published: published.value,
      });
      if (!pendingPublish.value) return;
      if (published.value) {
        pendingPublish.value = false;
        return;
      }
      if (!joined.value || !jitsi.room) return;
      if (tracks.length === 0) return;
      pendingPublish.value = false;
      await publishLocalTracksToRoom();
      published.value = true;
    };

    watch(joined, async (isJoined) => {
      if (isJoined) {
        await tryPublishWhenReady("joined-watch");
      }
    });

    const join = async () => {
      // Always record intent first so a slow precondition can wake the
      // publish later from its own callback. Previously this set the
      // pending flag only when not yet joined, which left the
      // "joined but tracks not yet acquired" race uncovered.
      pendingPublish.value = true;
      await tryPublishWhenReady("join-action");
    };

    const userStore = useUserStore();
    const nickname = computed(() => userStore.nickname);

    const loadeddata = () => {
      loading.value = false;

      if (el.value) {
        el.value.disablePictureInPicture = true;
      }
    };

    watch(el, (newEl) => {
      if (newEl) {
        newEl.disablePictureInPicture = true;
      }
    });

    return {
      blocked,
      blockedMessage,
      data,
      join,
      joined,
      el,
      nickname,
      loading,
      loadeddata,
    };
  },
};
</script>

<template>
  <div>
    <img v-if="loading" class="overlay" src="/img/videoloading.gif" />
    <div v-if="blocked" class="blocked-tag" :title="blockedMessage">
      <span class="tag is-warning is-small">{{ blockedMessage }}</span>
    </div>
    <Skeleton v-else :data="data" class="p-2" style="flex-direction: column" @dragstart="join">
      <video
        ref="el"
        :style="{ cursor: joined ? 'pointer' : 'not-allowed', height: '48px', marginBottom: '2px' }"
        :onClick="join"
        autoplay
        :muted.attr="true"
        playsinline
        disablePictureInPicture
        controlslist="nodownload nofullscreen noremoteplayback"
        @loadeddata="loadeddata"
        @contextmenu.prevent
      ></video>
      <span class="tag">{{ nickname }}</span>
    </Skeleton>
  </div>
</template>

<style scoped>
video {
  width: 100px;
  border-radius: 8px;
}

/*
 * Two complementary defences against the in-page PiP toggle:
 *   1. `disablePictureInPicture` HTML attribute (set in the
 *      template and force-mirrored as an IDL property by the
 *      watcher in setup()). Honoured by Firefox 71+ for both the
 *      `requestPictureInPicture()` API AND its hover-rendered
 *      chrome-injected toggle; also honoured by Chromium.
 *   2. This `::-webkit-media-controls-picture-in-picture-button`
 *      rule hides Chromium's pseudo-element-rendered toggle in
 *      case (1) is bypassed by a future browser change. Firefox
 *      does NOT expose its toggle via a pseudo-element, so there
 *      is no Firefox equivalent rule — but Firefox listens to (1)
 *      directly, so that's covered.
 * The earlier version of this comment claimed Firefox had no
 * per-element suppression API; that was true pre-71 and is no
 * longer the case.
 */
video::-webkit-media-controls-picture-in-picture-button {
  display: none !important;
}

video {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  -khtml-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
}

.overlay {
  position: absolute;
  width: 40%;
  left: 30%;
  top: 45%;
  -webkit-transform: translateY(-50%);
  -moz-transform: translateY(-50%);
  -ms-transform: translateY(-50%);
  transform: translateY(-50%);
}

.blocked-tag {
  padding: 4px;
  max-width: 200px;
  text-align: center;
  white-space: normal;
  font-size: 0.7rem;
}
</style>
