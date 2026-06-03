<script>
// Aliased: "Object" is a reserved HTML element name (vue/no-reserved-component-names).
import AppObject from "../Object.vue";
import Loading from "components/Loading.vue";
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { isIOS } from "utils/common";
import { playMediaElement, retryPlayOnUserGesture } from "@utils/mediaPlayback";
import { usePageWakeRecovery } from "@composables/usePageWakeRecovery";
import AvatarContextMenu from "../Avatar/ContextMenuAvatar.vue";

export default {
  components: { AppObject, Loading, AvatarContextMenu },
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
    let geomLogged = false;

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
      console.log("[diag] Jitsi.vue tracks recompute", {
        objectId: props.object.id,
        objectParticipantId: props.object.participantId,
        myUserId: jitsi?.room?.myUserId?.(),
        isOwnTile: isOwnTile.value,
        storeJitsiTracksLen: stageStore.jitsiTracks.length,
        storeJitsiTracksParticipantIds: stageStore.jitsiTracks.map((t) => t.getParticipantId?.()),
        roomLocalTracksLen: jitsi?.room?.getLocalTracks?.()?.length,
        roomLocalTracksParticipantIds: jitsi?.room
          ?.getLocalTracks?.()
          ?.map((t) => t.getParticipantId?.()),
        composableLocalLen: composableLocal.length,
        remoteMatchLen: remote.length,
      });
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
    const volume = computed(() => props.object.volume);

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
    const loadTrack = () => {
      console.log("[diag] Jitsi.vue loadTrack invoked", {
        objectId: props.object.id,
        tracksLen: tracks.value.length,
        videoTrack: videoTrack.value?.type,
        videoElExists: !!videoEl.value,
        audioTrack: audioTrack.value?.type,
        audioTrackIsLocal: audioTrack.value?.isLocal?.(),
        audioElExists: !!audioEl.value,
      });
      if (tracks.value.length) {
        try {
          if (videoTrack.value && videoEl.value) {
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
            console.log("[diag] Jitsi.vue loadTrack attached video to <video ref=videoEl>");
            // One-shot geometry probe: the audience reports "renders in the
            // log but I can't see it". Capture where/whether the <video>
            // actually lands on screen so we can tell layout vs CSS vs frames.
            if (!geomLogged) {
              geomLogged = true;
              setTimeout(() => {
                const v = videoEl.value;
                if (!v) return;
                const r = v.getBoundingClientRect();
                const cs = getComputedStyle(v);
                // Walk ancestors to flag any zero-size / hidden / clipped wrapper.
                const chain = [];
                let n = v;
                for (let i = 0; i < 8 && n; i++) {
                  const nr = n.getBoundingClientRect();
                  const ncs = getComputedStyle(n);
                  chain.push({
                    tag: n.tagName,
                    cls: typeof n.className === "string" ? n.className : "",
                    w: Math.round(nr.width),
                    h: Math.round(nr.height),
                    x: Math.round(nr.left),
                    y: Math.round(nr.top),
                    opacity: ncs.opacity,
                    display: ncs.display,
                    visibility: ncs.visibility,
                    overflow: ncs.overflow,
                    zIndex: ncs.zIndex,
                  });
                  n = n.parentElement;
                }
                console.log("[diag] Jitsi.vue video geometry", {
                  objectId: props.object.id,
                  videoWxH: `${v.videoWidth}x${v.videoHeight}`,
                  paused: v.paused,
                  readyState: v.readyState,
                  rect: {
                    w: Math.round(r.width),
                    h: Math.round(r.height),
                    x: Math.round(r.left),
                    y: Math.round(r.top),
                  },
                  opacity: cs.opacity,
                  display: cs.display,
                  visibility: cs.visibility,
                  ancestors: chain,
                });
              }, 600);
            }
          }
          if (audioTrack.value && !audioTrack.value.isLocal() && audioEl.value) {
            audioTrack.value.attach(audioEl.value);
            console.log("[diag] Jitsi.vue loadTrack attached audio to <audio ref=audioEl>");
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
    onMounted(loadTrack);
    watch(tracks, loadTrack, { flush: "post" });
    watch(
      () => props.object.participantId,
      () => loadTrack(),
      { flush: "post" },
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

    const clip = (shape) => {
      stageStore.shapeObject({
        ...props.object,
        shape,
      });
    };

    const localMuted = ref(false);
    const toggleMuted = () => {
      localMuted.value = !localMuted.value;
    };

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

    // `openSettingPopup` is synchronous — call the continuation inline.
    const openVolumePopup = (slotProps) => {
      stageStore.openSettingPopup({
        type: "VolumeParameters",
      });
      slotProps.closeMenu();
    };

    const loadeddata = () => {
      loading.value = false;
    };

    // iOS / iPadOS: HTMLMediaElement.volume is read-only, so a per-stream
    // volume slider would silently do nothing. Hide it on iOS rather than
    // present a control that lies to the performer.
    const supportsPerStreamVolume = !isIOS();

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
      clip,
      localMuted,
      toggleMuted,
      isPlayer,
      supportsPerStreamVolume,

      timeupdate,
      loadTrack,
      openVolumePopup,
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
          :style="{
            'border-radius': object.shape === 'circle' ? '100%' : '12px',
          }"
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
      <div class="field has-addons shape-group">
        <p class="control menu-group-item">Shape</p>
        <p class="control menu-group-item">
          <button class="button is-light" @click="clip(null)">
            <div class="icon">
              <i class="fas fa-square"></i>
            </div>
          </button>
        </p>
        <p class="control menu-group-item" @click="clip('circle')">
          <button class="button is-light">
            <div class="icon">
              <i class="fas fa-circle"></i>
            </div>
          </button>
        </p>
      </div>
      <a class="panel-block" @click="toggleMuted">
        <span class="panel-icon">
          <i v-if="localMuted" class="fas fa-volume-mute has-text-danger"></i>
          <i v-else class="fas fa-volume-up has-text-primary"></i>
        </span>
        <span>{{ localMuted ? "UnMute locally" : "Mute locally" }}</span>
      </a>
      <a v-if="supportsPerStreamVolume" class="panel-block" @click="openVolumePopup(slotProps)">
        <span class="panel-icon">
          <Icon src="voice-setting.svg" />
        </span>
        <span>{{ $t("volumn_setting") }}</span>
      </a>
      <AvatarContextMenu :object="object" v-bind="slotProps" />
    </template>
  </AppObject>
</template>

<style lang="scss" scoped>
video {
  width: 100%;
  height: 100%;
  object-fit: cover;
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

.shape-group {
  width: 100%;
  display: flex;
  align-items: center;
  text-align: center;

  .menu-group-item {
    flex: 1;

    button {
      width: 100%;
    }
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
