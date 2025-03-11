<template>
  <div class="card-header">
    <span class="card-header-title">{{ $t("volumne_setting") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <div class="content">
      <HorizontalField title="Volume">
        <a-slider v-model:value="parameters.volume" :min="0" :max="100" />
      </HorizontalField>
      <SaveButton @click="saveVolume" :loading="loading" />
    </div>
  </div>
</template>

<script>
import { reactive, computed } from "vue";
import { useStore } from "vuex";
import HorizontalField from "components/form/HorizontalField.vue";
import SaveButton from "components/form/SaveButton.vue";

export default {
  components: {
    HorizontalField,
    SaveButton,
  },
  props: ["modelValue"],
  emits: ["close", "update:modelValue"],
  setup: (props, { emit }) => {
    const store = useStore();
    const currentAvatar = computed(() => store.getters["stage/activeObject"]);
    const parameters = reactive({
      volume: currentAvatar.value?.volume,
    });
    const saveVolume = () => {
      let video = document.getElementById("video" + currentAvatar.value.id);
      video.volume = parameters.volume / 100;
      store
        .dispatch("stage/shapeObject", {
          ...currentAvatar.value,
          volume: parameters.volume,
        })
        .then(() => emit("close"));
    };

    return {
      saveVolume,
      parameters,
    };
  },
};
</script>

<style lang="scss"></style>
