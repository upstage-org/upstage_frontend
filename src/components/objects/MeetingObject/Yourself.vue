<script>
import Skeleton from "components/stage/Toolboxs/Skeleton.vue";
import { computed, inject, onActivated, onDeactivated, onMounted, reactive, ref, watch } from "vue";
import { useUserStore } from "@stores/pinia/user";
import { useStageStore } from "@stores/pinia/stage";
import { playMediaElement, retryPlayOnUserGesture } from "@utils/mediaPlayback";
import { endpointHostLabel, shortServerLabel } from "@utils/common";
import configs from "config";

export default {
  components: { Skeleton },
  props: {
    /**
     * Multi-server streaming: the Jitsi server this preview tile publishes
     * to (one of `configs.JITSI_ENDPOINTS`). The Meeting tab renders one
     * tile per configured server, so a dragged tile is bound to a server
     * the way an RTMP feed is bound to its MediaMTX. Omitted (single-server
     * builds, Playground): the classic tile on the default server.
     */
    server: { type: String, default: undefined },
  },
  setup(props) {
    const el = ref();
    const loading = ref(true);
    const stageStore = useStageStore();
    // Only a multi-server build binds tiles to a server; a single-server
    // build's drag payload must stay byte-identical (no `jitsiServer`).
    const serverOrigin =
      (configs.JITSI_SERVER_COUNT ?? 1) > 1 && props.server ? props.server : null;
    const isExtraServer = serverOrigin != null && serverOrigin !== configs.JITSI_ENDPOINT;
    // Badge text over the preview: the part of the host that differs between
    // the configured servers ("streaming" / "streaming3"); the full host is
    // in the tile's tooltip (Meeting tab).
    const hostLabel = computed(() =>
      serverOrigin
        ? shortServerLabel(serverOrigin, configs.JITSI_ENDPOINTS ?? []) ||
          endpointHostLabel(serverOrigin)
        : "",
    );
    const data = reactive({
      type: "jitsi",
      participantId: null,
      w: 100,
      h: 100,
      volume: 50,
      ...(serverOrigin ? { jitsiServer: serverOrigin } : {}),
    });

    const jitsi = inject("jitsi");
    const joined = inject("joined");
    const publisher = inject("localStreamPublisher", null);

    const blocked = computed(() => publisher?.blocked?.value ?? false);
    const blockedMessage = computed(() => publisher?.blockedMessage?.value ?? "");
    const localTracks = computed(() => jitsi?.localTracks?.value ?? []);

    const detachPreview = () => {
      const videoTrack = localTracks.value.find((t) => t.type === "video");
      if (videoTrack && el.value) {
        try {
          videoTrack.detach(el.value);
        } catch (e) {
          console.warn("Detaching local preview:", e);
        }
      }
    };

    const attachPreview = () => {
      const videoTrack = localTracks.value.find((t) => t.type === "video");
      if (!videoTrack || !el.value) return;
      // Idempotent attach: skip when the preview <video> already shows this
      // track's stream. attachPreview re-runs on watch(localTracks),
      // watch(el), onMounted, and onActivated (window refocus); without this
      // guard each re-run re-assigns srcObject and resets the element, which
      // is the same whole-board flicker fixed in Jitsi.vue's loadTrack.
      if (el.value.srcObject === videoTrack.stream) return;
      try {
        videoTrack.attach(el.value);
        el.value.disablePictureInPicture = true;
        playMediaElement(el.value, { muted: true, inline: true }).catch(() => {
          loading.value = false;
          // Autoplay was blocked. The idempotent srcObject guard above means
          // attachPreview will never call play() again for this stream, so
          // without a retry the preview stays a black box forever (same
          // recovery Jitsi.vue uses for on-stage tiles).
          retryPlayOnUserGesture(el.value);
        });
      } catch (e) {
        console.warn("Re-attaching local preview:", e);
      }
    };

    watch(localTracks, () => {
      if (localTracks.value.length > 0) {
        attachPreview();
        loading.value = false;
      } else {
        // The publisher released the local tracks while this preview is
        // visible (e.g. a legacy dispose path or a genuine device loss).
        // Show the loading state instead of a dead black <video> and ask
        // the publisher to re-acquire; ensureTracks no-ops when acquiring
        // is not allowed (audience / streaming off / blocked latch), so
        // this can never fight the deliberate release paths.
        loading.value = true;
        void publisher?.ensureTracks?.();
      }
    });

    watch(el, (videoEl) => {
      if (videoEl) {
        videoEl.disablePictureInPicture = true;
        attachPreview();
      }
    });

    onMounted(() => {
      void publisher?.ensureTracks?.();
      attachPreview();
    });

    onDeactivated(detachPreview);
    onActivated(() => {
      void publisher?.ensureTracks?.();
      attachPreview();
    });

    if (serverOrigin) {
      // Per-server tile: the participant id this tab has on THAT server,
      // recorded by the composable on that server's CONFERENCE_JOINED.
      watch(
        () => stageStore.localJitsiParticipantIds?.[serverOrigin] ?? null,
        (id) => (data.participantId = id),
        { immediate: true },
      );
    } else {
      watch(joined, () => (data.participantId = jitsi?.room?.myUserId?.() ?? null), {
        immediate: true,
      });
    }

    const join = async () => {
      if (isExtraServer) {
        // The tile lands on another server: publishing there is driven by
        // the board watcher in extraServerPublishers.ts once the tile
        // exists. Only make sure the camera is up — `publisher.join()`
        // would start sending to the DEFAULT server's room for a tile that
        // is not there.
        if (publisher?.ensureTracks) await publisher.ensureTracks();
        return;
      }
      if (publisher?.join) {
        await publisher.join();
      }
    };

    // Clicking the blocked warning retries the camera acquire — the blocked
    // latch otherwise requires a full page reload to clear (ensureTracks
    // refuses to re-acquire while blocked is set).
    const retryAcquire = async () => {
      if (publisher?.retryAcquire) {
        await publisher.retryAcquire();
      }
    };

    const userStore = useUserStore();
    const nickname = computed(() => userStore.nickname);

    const loadeddata = () => {
      loading.value = false;
      if (el.value) {
        el.value.disablePictureInPicture = true;
        const width = el.value.videoWidth;
        const height = el.value.videoHeight;
        if (width && height) {
          data.w = (100 * width) / height;
          data.h = 100;
        }
      }
    };

    return {
      blocked,
      blockedMessage,
      data,
      join,
      retryAcquire,
      el,
      nickname,
      hostLabel,
      loading,
      loadeddata,
    };
  },
};
</script>

<template>
  <div>
    <img v-if="loading && !blocked" class="overlay" src="/img/videoloading.gif" />
    <div
      v-if="blocked"
      class="blocked-tag"
      role="button"
      :title="blockedMessage"
      @click="retryAcquire"
    >
      <span class="tag is-warning is-small">{{ blockedMessage }}</span>
      <span class="tag is-light is-small">Click to try again</span>
    </div>
    <Skeleton v-else :data="data" class="p-2" style="flex-direction: column" @dragstart="join">
      <!--
        Cursor: always a pointer. Dragging the preview onto the stage does
        NOT require the conference to be joined (publish is deferred via
        pendingPublish and the board watcher), so the old
        `joined ? pointer : not-allowed` gate showed a red "blocked" cursor
        during the join handshake — and forever on a stage whose join stalls
        — for an action that actually works.
      -->
      <!--
        Multi-server: the server name is a badge OVER the preview (bottom
        edge), not a third row — the tile is a fixed 100px box shared with
        the icon tiles, and an extra row shifted the name label off the
        neighbours' baseline. The wrapper only exists when there is a badge
        so the single-server tile keeps its exact DOM.
      -->
      <div v-if="hostLabel" class="preview-box">
        <video
          ref="el"
          :style="{ cursor: 'pointer', height: '48px' }"
          :onClick="join"
          autoplay
          :muted.attr="true"
          playsinline
          disablePictureInPicture
          controlslist="nodownload nofullscreen noremoteplayback"
          @loadeddata="loadeddata"
          @contextmenu.prevent
        ></video>
        <span class="server-badge">{{ hostLabel }}</span>
      </div>
      <video
        v-else
        ref="el"
        :style="{ cursor: 'pointer', height: '48px', marginBottom: '2px' }"
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

.preview-box {
  position: relative;
  margin-bottom: 2px;
  line-height: 0;

  video {
    display: block;
  }
}

.server-badge {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 1px 4px;
  font-size: 0.6rem;
  line-height: 1.2;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 0 0 8px 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  pointer-events: none;
}

.blocked-tag {
  padding: 4px;
  max-width: 200px;
  text-align: center;
  white-space: normal;
  font-size: 0.7rem;
  cursor: pointer;
}
</style>
