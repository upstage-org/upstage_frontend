<script>
// Aliased: "Object" is a reserved HTML element name (vue/no-reserved-component-names).
import AppObject from "../Object.vue";
import Loading from "components/Loading.vue";
import { computed, inject, onMounted, onUnmounted, ref, watch } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { isIOS } from "utils/common";
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
    const joined = inject("joined");
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
      if (!isOwnTile.value) return remote;

      // Local tile: also include the conference's local tracks. The
      // qmu_copy code implicitly relied on lib-jitsi-meet putting
      // local tracks into `getLocalTracks()` synchronously after
      // `room.addTrack()` resolved, so the per-participantId filter
      // always saw them. Mirror that behaviour explicitly here so the
      // performer's own on-stage tile renders even if the store entry
      // hasn't been re-published yet via TRACK_ADDED. Dedupe by
      // JitsiTrack.getId() so we never attach the same MediaStream
      // twice.
      const local = jitsi?.room?.getLocalTracks?.() ?? [];
      const seen = new Set(remote.map((t) => t.getId?.()));
      for (const t of local) {
        const id = t.getId?.();
        if (id === undefined || !seen.has(id)) {
          remote.push(t);
          if (id !== undefined) seen.add(id);
        }
      }
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
      if (tracks.value.length) {
        try {
          if (videoTrack.value) {
            videoTrack.value.attach(videoEl.value);
          }
          if (audioTrack.value && !audioTrack.value.isLocal()) {
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
      joined,
      (val) => {
        if (val) {
          const participants = jitsi.room
            .getParticipants()
            .map((p) => p.getId())
            .concat(jitsi.room.myUserId());
          if (!participants.some((p) => p === props.object.participantId)) {
            stageStore.deleteObject(props.object);
          }
        }
      },
      { immediate: true },
    );

    watch(
      reloadStreams,
      (val) => {
        if (val) {
          loadTrack();
        }
      },
      { immediate: true },
    );

    onMounted(() => loadTrack);

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
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch((err) => {
              console.warn("Remote stream audio autoplay was blocked:", err);
              const retry = () => {
                audio.play().catch(() => {});
                window.removeEventListener("pointerdown", retry);
                window.removeEventListener("keydown", retry);
              };
              window.addEventListener("pointerdown", retry, { once: true });
              window.addEventListener("keydown", retry, { once: true });
            });
          }
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
        <video
          ref="videoEl"
          autoplay
          muted
          playsinline
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
</style>
