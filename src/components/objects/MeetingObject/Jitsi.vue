<template>
  <Object :object="object">
    <template #render>
      <div v-if="!videoTrack && !audioTrack" class="loading">
        <Loading width="auto" height="22px" src="img/videoloading.gif"/>
      </div>
      <template v-else>
        <video autoplay ref="videoEl" :style="{
          'border-radius': object.shape === 'circle' ? '100%' : '12px',
        }" @timeupdate="timeupdate"
        @loadeddata="loadeddata">
          Please click on Refresh Stream button.
        </video>
        <audio autoplay ref="audioEl" :muted="localMuted" v-bind:id="'video' + object.id"></audio>
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
      <a class="panel-block" @click="openVolumePopup(slotProps)">
        <span class="panel-icon">
          <Icon src="voice-setting.svg" />
        </span>
        <span>{{ $t("volumn_setting") }}</span>
      </a>
      <AvatarContextMenu :object="object" v-bind="slotProps" />
    </template>
  </Object>
</template>

<script>
import Object from "../Object.vue";
import Loading from "components/Loading.vue";
import { computed, inject, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import AvatarContextMenu from "../Avatar/ContextMenuAvatar.vue";

export default {
  components: { Object, Loading, AvatarContextMenu },
  props: ["object", "closeMenu"],
  setup: (props) => {
    const store = useStore();
    const videoEl = ref();
    const audioEl = ref();
    const loading = ref(true);

    const tracks = computed(() =>
      store.getters["stage/jitsiTracks"].filter(
        (t) => t.getParticipantId() === props.object.participantId,
      ),
    );
    const volume = computed(() => props.object.volume);

    const reloadStreams = computed(() => store.getters["stage/reloadStreams"]);
    const videoTrack = computed(() => {
      const vTracks = tracks.value.filter((t) => t.type === "video")
      if (vTracks.find(t => t.stream.active)) return vTracks.find(t => t.stream.active)
      return vTracks[0]
    });
    const audioTrack = computed(() => {
      const aTracks = tracks.value.filter((t) => t.type === "audio")
      if (aTracks.find(t => t.stream.active)) return aTracks.find(t => t.stream.active)
      return aTracks[0]
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

    const interval = setInterval(loadTrack, 3000);
    const joined = inject("joined");
    const jitsi = inject("jitsi");

    watch(
      joined,
      (val) => {
        if (val) {
          const participants = jitsi.room
            .getParticipants()
            .map((p) => p.getId())
            .concat(jitsi.room.myUserId());
          if (!participants.some((p) => p === props.object.participantId)) {
            store.dispatch("stage/deleteObject", props.object);
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
      store.dispatch("stage/shapeObject", {
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
        }
      },
      { immediate: true },
    );

    const isPlayer = computed(() => store.getters["stage/canPlay"]);

    const timeupdate = (e) => {
      interval && clearInterval(interval);
    }

    const openVolumePopup = (slotProps) => {
      store
        .dispatch("stage/openSettingPopup", {
          type: "VolumeParameters",
        })
        .then(slotProps.closeMenu);
    }

    const loadeddata = () => {
      loading.value=false;
    }

    return {
      videoTrack,
      audioTrack,
      videoEl,
      audioEl,
      clip,
      localMuted,
      toggleMuted,
      isPlayer,

      timeupdate,
      loadTrack,
      openVolumePopup,
      loadeddata,
      loading
    };
  },
};
</script>

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
