<script>
import Skeleton from "components/stage/Toolboxs/Skeleton.vue";
import { computed, inject, onMounted, reactive, ref, watch } from "vue";
import { useStore } from "vuex";
import { useLowLevelAPI } from "./composable";

export default {
  components: { Skeleton },
  setup() {
    let tracks = [];
    const el = ref();
    const blocked = ref(false);
    const loading = ref(true);
    const data = reactive({
      type: "jitsi",
      participantId: null,
      w: 100,
      h: 100,
      volume: 50
    });

    const jitsi = inject("jitsi");
    const joined = inject("joined");
    const JitsiMeetJS = useLowLevelAPI();

    onMounted(() => {
      JitsiMeetJS.createLocalTracks({ devices: ["audio", "video"] })
        .then((track) => {
          for (const t of track) {
            tracks.push(t);
            if (t.type === "video") {
              t.attach(el.value);
              
              if (el.value) {
                el.value.disablePictureInPicture = true;
                
                el.value.addEventListener('enterpictureinpicture', (e) => {
                  e.preventDefault();
                  console.log('Picture-in-Picture đã bị chặn');
                });
              }
              
              el.value.addEventListener("loadedmetadata", () => {
                const width = el.value.videoWidth;
                const height = el.value.videoHeight;
                data.w = (100 * width) / height;
                data.h = 100;
              });
            }
          }
        })
        .catch((err) => {
          console.error(
            "Failed to create local tracks. Please check your camera and microphone permissions.",
            err,
          );
          blocked.value = true;
        });
    });

    watch(joined, () => (data.participantId = jitsi.room?.myUserId()), {
      immediate: true,
    });

    const join = () => {
      if (joined.value) {
        for (const t of tracks) {
          jitsi.room.addTrack(t);
        }
      }
    };

    const store = useStore();
    const nickname = computed(() => store.getters["user/nickname"]);

    const loadeddata = () => {
      loading.value = false;
      
      if (el.value) {
        el.value.disablePictureInPicture = true;
      }
    }

    const disableAllPictureInPicture = () => {
      if (el.value) {
        el.value.disablePictureInPicture = true;
      }
      
      document.querySelectorAll('video').forEach(video => {
        video.disablePictureInPicture = true;
      });
    };

    watch(el, (newEl) => {
      if (newEl) {
        newEl.disablePictureInPicture = true;
      }
    });

    return {
      blocked,
      data,
      join,
      joined,
      el,
      nickname,
      loading,
      loadeddata,
      disableAllPictureInPicture
    }
  },
};
</script>

<template>
  <div>
    <img v-if="loading" class="overlay" src="/img/videoloading.gif" />
    <Skeleton v-if="!blocked" :data="data" class="p-2" :onDragstart="join" style="flex-direction: column;">
      <video 
        :style="{ cursor: joined ? 'pointer' : 'not-allowed', height: '48px', marginBottom: '2px' }"
        :onClick="join" 
        autoplay 
        ref="el"  
        @loadeddata="loadeddata"
        disablePictureInPicture
        @contextmenu.prevent
        controlslist="nodownload nofullscreen noremoteplayback">
      </video>
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

video::-moz-media-controls-picture-in-picture-button {
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
</style>