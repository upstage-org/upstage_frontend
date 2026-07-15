<script>
// Aliased: "Object" is a reserved HTML element name (vue/no-reserved-component-names).
import AppObject from "../Object.vue";
import Loading from "components/Loading.vue";
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { playMediaElement, retryPlayOnUserGesture } from "@utils/mediaPlayback";
import { usePageWakeRecovery } from "@composables/usePageWakeRecovery";
import StreamContextMenu from "../ContextMenuStream.vue";
import { useStreamFreezeDetector } from "./useStreamFreezeDetector";
import { useStreamFreezeReporter } from "./useStreamFreezeReporter";

export default {
  components: { AppObject, Loading, StreamContextMenu },
  props: {
    object: Object,
    closeMenu: Function,
  },
  setup: (props) => {
    const stageStore = useStageStore();
    // jitsi must be injected before the `tracks` computed so the
    // local-tile fallback below can read jitsi.room.getLocalTracks().
    // jitsi.room may be null until CONFERENCE_JOINED has fired; the
    // computed handles that with optional chaining.
    const jitsi = inject("jitsi");
    const videoEl = ref();
    const audioEl = ref();
    const loading = ref(true);

    const isOwnTile = computed(() => {
      const myId = jitsi?.room?.myUserId?.();
      return myId != null && props.object.participantId === myId;
    });

    const tracks = computed(() => {
      const remote = stageStore.jitsiTracks.filter(
        (t) => t.getParticipantId() === props.object.participantId,
      );
      // Own-tile fast-path tracks: tracks acquired by Yourself.vue and
      // published into the shared composable ref the moment
      // `createLocalTracks` resolved, BEFORE the conference round-trip.
      // Read it eagerly (even when this isn't the own tile) so Vue
      // registers the dependency and we recompute when Yourself.vue
      // swaps the array.
      const composableLocal = jitsi?.localTracks?.value ?? [];
      if (!isOwnTile.value) return remote;

      // Local tile: combine
      //   (a) anything that already made it into `stageStore.jitsiTracks`
      //       via the normal `addTrack` path (when the conference is
      //       healthy this is the canonical source), and
      //   (b) the conference's `getLocalTracks()` — covers the legacy
      //       path where lib-jitsi-meet has the track on the room but
      //       the store-republish hasn't fired yet, and
      //   (c) the composable's `localTracks` ref written by Yourself.vue
      //       directly from `createLocalTracks`, which is the ONLY
      //       source that works when the conference join is stalled
      //       (the "preview works, dragged tile spins forever" symptom).
      // Dedupe by JitsiTrack.getId() so a track that exists in multiple
      // sources only gets attached once.
      const local = jitsi?.room?.getLocalTracks?.() ?? [];
      const seen = new Set(remote.map((t) => t.getId?.()));
      const pushUnique = (t) => {
        const id = t?.getId?.();
        if (id === undefined || !seen.has(id)) {
          remote.push(t);
          if (id !== undefined) seen.add(id);
        }
      };
      for (const t of local) pushUnique(t);
      for (const t of composableLocal) pushUnique(t);
      return remote;
    });
    // Listening level for THIS browser only (never broadcast — several
    // performers in one room each control their own playback; see the
    // stream store's `_streamLocalAudio`). Set from the context menu's
    // Volume setting / Mute locally items.
    const volume = computed(() => stageStore.streamLocalVolume(props.object.id));
    const localMuted = computed(() => stageStore.streamLocalMuted(props.object.id));

    const reloadStreams = computed(() => stageStore.reloadStreams);
    const videoTrack = computed(() => {
      const vTracks = tracks.value.filter((t) => t.type === "video");
      if (vTracks.find((t) => t.stream.active)) return vTracks.find((t) => t.stream.active);
      return vTracks[0];
    });
    const audioTrack = computed(() => {
      const aTracks = tracks.value.filter((t) => t.type === "audio");
      if (aTracks.find((t) => t.stream.active)) return aTracks.find((t) => t.stream.active);
      return aTracks[0];
    });

    // Viewer-side freeze detection + reporting. The detector watches the
    // <video> for stalled frames; the reporter forwards a freeze/recovery to
    // the publisher over MQTT (no-op for our own tiles / audio-only tiles).
    const hasVideo = computed(() => !!videoTrack.value);
    const { frozen } = useStreamFreezeDetector(videoEl, hasVideo);
    useStreamFreezeReporter(() => props.object, frozen);
    const loadTrack = (force = false) => {
      if (tracks.value.length) {
        try {
          // `force` (explicit user "Refresh streams" click) detaches then
          // re-attaches even when the same MediaStream is already bound —
          // this resets a stuck decoder that is holding a frozen last frame.
          // Every implicit caller (mount, tracks/participant watch, gentle
          // reload watch, 3s poll) leaves `force` false so the idempotent
          // guard below still prevents the whole-board flicker.
          //
          // Idempotent attach: only (re)attach when the element isn't
          // already showing this track's stream. After a successful
          // lib-jitsi-meet `attach`, `el.srcObject` IS the track's
          // MediaStream (the same `t.stream` read above), so a reference
          // check is the correct "already attached" test. Without this
          // guard, every spurious `loadTrack` re-fire — `watch(tracks)`
          // when the `objects` computed re-clones board objects on any
          // avatar move, `watch(reloadStreams)` on window refocus, the 3s
          // polling tick — re-assigns `srcObject` and resets the media
          // element, which is the visible whole-board flicker. The first
          // attach (srcObject null), a track swap (different stream), and
          // a fresh element after remount all still attach because the
          // equality check fails in those cases.
          if (force && videoTrack.value && videoEl.value) {
            try {
              videoTrack.value.detach(videoEl.value);
            } catch (e) {
              console.warn("Force-detaching video track:", e);
            }
          }
          if (
            videoTrack.value &&
            videoEl.value &&
            (force || videoEl.value.srcObject !== videoTrack.value.stream)
          ) {
            videoTrack.value.attach(videoEl.value);
            // Mirror the `disablePictureInPicture` HTML attribute as
            // an IDL property. Vue 3 patches some HTMLMediaElement
            // attributes via setAttribute and others via property
            // assignment, and `disablePictureInPicture` falls into
            // the property-only path on some patch versions — which
            // means the attribute appears in the DOM but Firefox /
            // Chromium read the IDL property and ignore it. Setting
            // it explicitly here closes that window. Same pattern as
            // Yourself.vue's `el.value.disablePictureInPicture = true`
            // and its watcher.
            videoEl.value.disablePictureInPicture = true;
          }
          if (force && audioTrack.value && !audioTrack.value.isLocal() && audioEl.value) {
            try {
              audioTrack.value.detach(audioEl.value);
            } catch (e) {
              console.warn("Force-detaching audio track:", e);
            }
          }
          if (
            audioTrack.value &&
            !audioTrack.value.isLocal() &&
            audioEl.value &&
            (force || audioEl.value.srcObject !== audioTrack.value.stream)
          ) {
            audioTrack.value.attach(audioEl.value);
          }
        } catch (error) {
          console.log("Error on attaching track", error);
        }
      }
    };

    // Polling fallback in case the initial CONFERENCE_JOINED -> TRACK_ADDED
    // sequence races the component mount. Cleared inside `timeupdate`
    // (when the video starts producing frames) AND on unmount, so it does
    // not keep firing against a stale ref after the meeting tile is
    // removed from the stage.
    const interval = setInterval(loadTrack, 3000);
    onUnmounted(() => {
      if (interval) clearInterval(interval);
    });

    watch(
      reloadStreams,
      (val) => {
        if (val) {
          loadTrack();
        }
      },
      { immediate: true },
    );

    // The previous `onMounted(() => loadTrack)` was a no-op: the arrow
    // returned the `loadTrack` reference instead of calling it, so the
    // initial attach only happened on the next 3-second polling tick
    // (and even then it raced with the DOM swap between the no-track
    // loading branch and the `<video ref=videoEl>` branch). Call it on
    // mount, and *also* re-run it any time the `tracks` computed flips
    // (e.g. when the local performer drags their self-preview onto the
    // stage and `stageStore.addTrack(t)` fires synchronously after
    // `await room.addTrack(t)` resolves). `flush: "post"` ensures Vue
    // has applied the conditional swap before we read `videoEl.value`.
    onMounted(() => loadTrack());
    // Wrap in an arrow: a bare `loadTrack` here would receive the watcher's
    // (newVal, oldVal) args, making `force` truthy and re-detaching on every
    // tracks change — the exact whole-board flicker the idempotent guard
    // exists to prevent.
    watch(tracks, () => loadTrack(), { flush: "post" });
    watch(
      () => props.object.participantId,
      () => loadTrack(),
      { flush: "post" },
    );

    // Explicit user "Refresh streams" click: force a detach + re-attach to
    // reset a stuck decoder. Separate from the gentle `reloadStreams` watch
    // above so only the button (not automatic page-wake) bypasses the guard.
    watch(
      () => stageStore.forceReloadStreams,
      (val) => {
        if (val) loadTrack(true);
      },
    );

    // Independent of track attach: any time the <video> ref settles on
    // a new element (initial mount or after the no-track / has-track
    // template branch flips back and forth), force-set the IDL
    // property. Belt-and-braces against the loadTrack path racing the
    // DOM swap; see the matching comment inside loadTrack above.
    watch(
      videoEl,
      (el) => {
        if (el) el.disablePictureInPicture = true;
      },
      { immediate: true },
    );

    // Re-apply volume whenever this browser's local level changes. The
    // audioEl watcher below only fires when the <audio> element itself is
    // (re)created, so without this a Volume-setting save would land in the
    // store but never reach the already-mounted <audio> element.
    watch(volume, (v) => {
      if (audioEl.value) {
        audioEl.value.volume = (v || 0) / 100;
      }
    });

    watch(
      audioEl,
      (audio) => {
        if (audio) {
          audio.volume = (volume.value || 0) / 100;
          // Safari (desktop and iOS) blocks <audio autoplay> on a
          // MediaStream that carries an unmuted audio track until the
          // user has interacted with the page. The audience needs to
          // hear the stream from the first packet, so attempt play()
          // explicitly and surface (not throw) the rejection — the next
          // user gesture (e.g. clicking on the stage) will re-trigger
          // it via the browser's autoplay-allowance window.
          playMediaElement(audio).catch(() => {
            retryPlayOnUserGesture(audio);
          });
        }
      },
      { immediate: true },
    );

    const isPlayer = computed(() => stageStore.canPlay);

    const timeupdate = () => {
      interval && clearInterval(interval);
    };

    const loadeddata = () => {
      loading.value = false;
    };

    usePageWakeRecovery(() => {
      if (audioEl.value) {
        playMediaElement(audioEl.value).catch(() => retryPlayOnUserGesture(audioEl.value));
      }
      if (videoEl.value) {
        playMediaElement(videoEl.value, { muted: true, inline: true }).catch(() => {});
      }
    });

    return {
      videoTrack,
      audioTrack,
      videoEl,
      audioEl,
      localMuted,
      isPlayer,

      timeupdate,
      loadTrack,
      loadeddata,
      loading,
    };
  },
};
</script>

<template>
  <AppObject :object="object">
    <template #render>
      <div v-if="!videoTrack && !audioTrack" class="loading">
        <Loading width="auto" height="22px" src="img/videoloading.gif" />
      </div>
      <template v-else>
        <!--
          Audience-facing remote-peer stream. Suppress browser PiP and
          related media controls so the bottom-right black PiP toggle
          that Firefox / Chromium overlay on hover doesn't (a) cover
          the chat and (b) let the audience pop the stream into a
          floating window and leave a black rectangle on stage.

            - `disablePictureInPicture` HTML attribute: honoured by
              Firefox 71+ and by Chromium for both the
              `requestPictureInPicture()` API and the hover toggle.
              Also mirrored via JS in `attachPipGuards()` below to
              defeat Vue 3's property-only patching of HTMLMediaElement
              attributes (same workaround Yourself.vue uses).
            - `controlslist="nodownload nofullscreen noremoteplayback"`:
              suppresses the matching items from Chromium's overflow
              menu in case `controls` is ever flipped on by a future
              edit. Firefox ignores this list but doesn't expose those
              actions for muted controls-less video anyway.
            - The scoped CSS rule on `video::-webkit-media-controls-
              picture-in-picture-button` hides the Chromium toggle in
              the unlikely case the attribute is bypassed.
        -->
        <video
          ref="videoEl"
          autoplay
          :muted.attr="true"
          playsinline
          disablePictureInPicture
          controlslist="nodownload nofullscreen noremoteplayback"
          @timeupdate="timeupdate"
          @loadeddata="loadeddata"
        >
          Please click on Refresh Stream button.
        </video>
        <!--
          The remote peer's audio is intentionally routed through the
          sibling <audio> element below (so per-stream volume/mute can be
          managed independently of the <video>). The <video> itself is
          therefore always `muted`, which has the side benefit of
          satisfying Safari's autoplay policy for MediaStreams that carry
          an audio track. `playsinline` keeps iOS Safari from yanking the
          stream into fullscreen the first frame it decodes.
        -->
        <audio :id="'video' + object.id" ref="audioEl" autoplay :muted="localMuted"></audio>
        <img v-if="loading" class="overlay" src="/img/videoloading.gif" />
      </template>
    </template>
    <template #menu="slotProps">
      <!-- One standardised menu for every live stream tile — jitsi and RTMP
           share ContextMenuStream, so both kinds behave identically. -->
      <StreamContextMenu :object="object" v-bind="slotProps" />
    </template>
  </AppObject>
</template>

<style lang="scss" scoped>
video {
  width: 100%;
  height: 100%;
  // The picture stretches with the freely-resizable frame (Moveable exempts
  // stream tiles from keepRatio) — distortion is a creative choice.
  object-fit: fill;
  display: block;
}
</style>

<style lang="scss" scoped>
.refresh-icon {
  position: absolute;
  width: 20px;
  height: 20px;
  top: 8px;
  right: 8px;
  padding: 0px;

  &:hover {
    transform: scale(1.2);
  }
}

.mute-icon {
  position: absolute;
  width: 24px;
  height: 20px;
  bottom: 8px;
  right: 8px;

  &:hover {
    transform: scale(1.2);
  }
}

.loading {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}
.overlay {
  position: absolute;
  width: 40%;
  left: 30%;
  top: 50%;
  -webkit-transform: translateY(-50%);
  -moz-transform: translateY(-50%);
  -ms-transform: translateY(-50%);
  transform: translateY(-50%);
  z-index: -1;
}

/*
  Belt-and-braces suppression of the Chromium picture-in-picture
  toggle. The `disablePictureInPicture` attribute on the <video> is
  the primary defence (and the only thing Firefox listens to); this
  rule hides Chromium's hover-rendered button in the pseudo-element
  tree as a fallback. See the matching CSS comment in
  Yourself.vue / Streams/index.vue for the per-engine rationale.
*/
video::-webkit-media-controls-picture-in-picture-button {
  display: none !important;
}
</style>
