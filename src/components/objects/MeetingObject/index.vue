<template>
  <div>
    <Object :object="meeting">
      <template #render>
        <div id="meeting-room" class="frame" :style="{ width: object.w + 'px', height: object.h + 'px' }"
          :class="activeMovable ? 'disable-pointer' : ''">
          <Loading v-if="loading" height="100%" />
          <div class="room" ref="room"></div>
        </div>
      </template>
    </Object>
  </div>
</template>

<script setup>
import Object from "../Object.vue";
import Loading from "components/Loading.vue";
import { computed, onMounted, ref } from "vue";
import { useUserStore } from "store/modules/user";
import { useStageStore } from "store/modules/stage";
import { useJitsiDomain } from "./composable";

const props = defineProps({
  object: {
    type: Object,
    required: true
  }
});

const userStore = useUserStore();
const stageStore = useStageStore();
const room = ref();
const loading = ref(true);

const meeting = computed(() => props.object);
const activeMovable = computed(() => stageStore.activeMovable);

onMounted(() => {
  const domain = useJitsiDomain();
  const options = {
    roomName: props.object.name,
    subject: "Powered by Jitsi",
    width: "100%",
    height: "100%",
    parentNode: room.value,
    userInfo: {
      email: userStore.whoami?.email,
      displayName: userStore.chatname,
    },
    configOverwrite: {
      prejoinPageEnabled: false,
      startVideoMuted: 1,
      startAudioMuted: 1,
    },
    interfaceConfigOverwrite: { SHOW_CHROME_EXTENSION_BANNER: false },
    disableInitialGUM: true,
  };
  const api = new window.JitsiMeetExternalAPI(domain, options);
  console.log(api);
  loading.value = false;
});
</script>

<style lang="scss" scoped>
.frame {
  border: 2px solid black;
  border-top: 10px solid #007011;
  border-radius: 8px;
  box-sizing: border-box;
  overflow: hidden;

  .room {
    height: 100%;
  }
}

.disable-pointer {
  pointer-events: none;
}
</style>
