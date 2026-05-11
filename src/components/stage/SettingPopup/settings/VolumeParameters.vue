<script>
import { reactive, computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
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
    const parameters = reactive({
      volume: currentAvatar.value?.volume,
    });
    // `shapeObject` is synchronous in Pinia; the previous `.then(() =>
    // emit("close"))` was a Vuex dispatch artefact (see VoiceParameters
    // for the same pattern).
    const saveVolume = () => {
      let video = document.getElementById("video" + currentAvatar.value.id);
      video.volume = parameters.volume / 100;
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
