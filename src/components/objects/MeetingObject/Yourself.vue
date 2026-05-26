<script>
import Skeleton from "components/stage/Toolboxs/Skeleton.vue";
import {
  computed,
  inject,
  onActivated,
  onDeactivated,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import { useUserStore } from "@stores/pinia/user";
import { playMediaElement } from "@utils/mediaPlayback";

export default {
  components: { Skeleton },
  setup() {
    const el = ref();
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
      try {
        videoTrack.attach(el.value);
        el.value.disablePictureInPicture = true;
        playMediaElement(el.value, { muted: true, inline: true }).catch(() => {
          loading.value = false;
        });
      } catch (e) {
        console.warn("Re-attaching local preview:", e);
      }
    };

    watch(localTracks, () => {
      if (localTracks.value.length > 0) {
        attachPreview();
        loading.value = false;
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

    watch(joined, () => (data.participantId = jitsi?.room?.myUserId?.() ?? null), {
      immediate: true,
    });

    const join = async () => {
      if (publisher?.join) {
        await publisher.join();
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
    <img v-if="loading && !blocked" class="overlay" src="/img/videoloading.gif" />
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
