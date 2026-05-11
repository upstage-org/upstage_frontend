<script>
// Aliased: "Object" is a reserved HTML element name (vue/no-reserved-component-names).
import AppObject from "../Object.vue";
import Loading from "components/Loading.vue";
import { computed, onMounted, ref } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import { useJitsiDomain } from "./composable";

export default {
  components: { AppObject, Loading },
  props: { object: Object },
  setup: (props) => {
    const stageStore = useStageStore();
    const userStore = useUserStore();
    const room = ref();
    const meeting = computed(() => props.object);

    onMounted(() => {
      const domain = useJitsiDomain();
      const options = {
        roomName: props.object.name,
        subject: "Powered by Jitsi",
        width: "100%",
        height: "100%",
        parentNode: room.value,
        userInfo: {
          email: userStore.user?.email,
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
    });

    const activeMovable = computed(() => stageStore.activeMovable);

    return { meeting, room, activeMovable };
  },
};
</script>

<template>
  <div>
    <AppObject :object="meeting">
      <template #render>
        <div
          id="meeting-room"
          class="frame"
          :style="{ width: object.w + 'px', height: object.h + 'px' }"
          :class="activeMovable ? 'disable-pointer' : ''"
        >
          <Loading v-if="loading" height="100%" />
          <div ref="room" class="room"></div>
        </div>
      </template>
    </AppObject>
  </div>
</template>

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
