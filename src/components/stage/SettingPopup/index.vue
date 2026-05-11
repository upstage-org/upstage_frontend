<script>
import { computed, ref } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import ChatBox from "./settings/ChatBox.vue";
import ChatParameters from "./settings/ChatParameters.vue";
import VoiceParameters from "./settings/VoiceParameters.vue";
import SaveScene from "./settings/SaveScene.vue";
import Icon from "components/Icon.vue";
import VolumeParameters from "./settings/VolumeParameters.vue";
import CreateRoom from "./settings/CreateRoom.vue";

export default {
  components: {
    ChatParameters,
    VoiceParameters,
    Icon,
    ChatBox,
    SaveScene,
    VolumeParameters,
    CreateRoom,
  },
  setup: () => {
    const stageStore = useStageStore();
    const isActive = computed(() => stageStore.settingPopup.isActive);
    const type = computed(() => stageStore.settingPopup.type);
    const title = computed(() => stageStore.settingPopup.title);
    const simple = computed(() => stageStore.settingPopup.simple);
    const modal = ref();

    const close = () => {
      stageStore.closeSettingPopup();
    };
    return { isActive, close, modal, type, title, simple };
  },
};
</script>

<template>
  <transition name="fade">
    <div v-if="type" class="modal" :class="{ 'is-active': isActive }">
      <div class="modal-background" @click="close"></div>
      <component :is="type" v-if="simple" @close="close" />
      <div v-else ref="modal" class="modal-content">
        <div class="card">
          <a href="#" class="card-header-icon" @click="close">
            <span class="icon">
              <Icon src="close.svg" />
            </span>
          </a>
          <component :is="type" @close="close" />
        </div>
      </div>
    </div>
  </transition>
</template>
<style scoped lang="scss">
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.card-header-icon {
  position: absolute;
  right: 0;
}
</style>
