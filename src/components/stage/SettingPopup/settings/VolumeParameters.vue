<script>
import { reactive, computed, watch, onUnmounted } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { isJitsiBoardType } from "@utils/common";
import HorizontalField from "components/form/HorizontalField.vue";
import SaveButton from "components/form/SaveButton.vue";

export default {
  components: {
    HorizontalField,
    SaveButton,
  },
  props: { modelValue: [Number, String] },
  emits: ["close", "update:modelValue"],
  setup: (props, { emit }) => {
    const stageStore = useStageStore();
    const currentAvatar = computed(() => stageStore.activeObject);
    // Live stream tiles (jitsi + RTMP): volume is LOCAL to this browser
    // (stage store `_streamLocalAudio`, applied by Jitsi.vue /
    // LiveStreamPlayer.vue) and never broadcast — several performers in one
    // room each set their own level without echoing each other. Video files
    // keep the legacy behaviour: the level rides shapeObject to everyone.
    const isLiveStreamTile = computed(
      () => isJitsiBoardType(currentAvatar.value?.type) || currentAvatar.value?.isRTMP === true,
    );
    const parameters = reactive({
      volume: isLiveStreamTile.value
        ? stageStore.streamLocalVolume(currentAvatar.value?.id)
        : currentAvatar.value?.volume,
    });

    // Live preview: dragging the slider adjusts THIS browser's playback
    // immediately so the level can be found by ear; nothing is persisted
    // (store write / shapeObject broadcast) until Save. Both tile kinds
    // render their sounding element with id "video<objectId>" — the jitsi
    // sibling <audio> and the RTMP / video-file <video>.
    const initialVolume = parameters.volume ?? 100;
    const applyToElement = (volume) => {
      const el = document.getElementById("video" + currentAvatar.value?.id);
      if (el) el.volume = (volume || 0) / 100;
    };
    watch(
      () => parameters.volume,
      (volume) => applyToElement(volume),
    );
    // Closed without saving (X / click outside): put the level back where
    // it was. After a save the persisted paths own the element again.
    let saved = false;
    onUnmounted(() => {
      if (!saved) applyToElement(initialVolume);
    });

    // `shapeObject` is synchronous in Pinia; the previous `.then(() =>
    // emit("close"))` was a Vuex dispatch artefact (see VoiceParameters
    // for the same pattern).
    const saveVolume = () => {
      saved = true;
      if (isLiveStreamTile.value) {
        stageStore.setStreamLocalVolume(currentAvatar.value.id, parameters.volume);
        emit("close");
        return;
      }
      applyToElement(parameters.volume);
      stageStore.shapeObject({
        ...currentAvatar.value,
        volume: parameters.volume,
      });
      emit("close");
    };

    return {
      saveVolume,
      parameters,
    };
  },
};
</script>

<template>
  <div class="card-header">
    <span class="card-header-title">{{ $t("volumne_setting") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <div class="content">
      <HorizontalField title="Volume">
        <a-slider v-model:value="parameters.volume" :min="0" :max="100" />
      </HorizontalField>
      <SaveButton :loading="loading" @click="saveVolume" />
    </div>
  </div>
</template>

<style lang="scss"></style>
