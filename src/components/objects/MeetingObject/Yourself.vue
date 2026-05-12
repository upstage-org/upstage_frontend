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
    });

    watch(joined, () => (data.participantId = jitsi.room?.myUserId()), {
      immediate: true,
    });

    const join = async () => {
      if (!joined.value) return;
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
    <Skeleton v-else :data="data" class="p-2" :on-dragstart="join" style="flex-direction: column">
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
 * `disablePictureInPicture` is the JS attribute path; the matching
 * vendor-prefixed pseudo-element only exists in Chromium. Firefox does
 * NOT expose its PiP toggle via `::-moz-media-controls-...` — Firefox's
 * PiP button is a chrome-injected overlay outside the video's pseudo
 * tree, and there is no per-element web API to suppress it. The
 * previously-included `::-moz-media-controls-picture-in-picture-button`
 * rule was dead code and has been removed; if/when Firefox exposes a
 * suppression API we can revisit.
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
