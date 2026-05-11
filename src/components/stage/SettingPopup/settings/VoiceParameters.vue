<script>
import { computed, reactive, ref } from "vue";
import SaveButton from "components/form/SaveButton.vue";
import { useStageStore } from "@stores/pinia/stage";
import { avatarSpeak } from "services/speech";
import { getDefaultVariant, getVariantList, getVoiceList } from "services/speech/voice";

export default {
  components: {
    SaveButton,
  },
  props: { modelValue: Object },
  emits: ["close", "update:modelValue"],
  setup: (props, { emit }) => {
    const stageStore = useStageStore();
    const currentAvatar = computed(() => stageStore.currentAvatar);
    const voices = getVoiceList();
    const variants = getVariantList();
    const parameters = reactive(props.modelValue ? props.modelValue : currentAvatar.value?.voice);
    if (!parameters.variant) {
      parameters.variant = getDefaultVariant();
    }
    const test = ref("Welcome to UpStage!");
    const testVoice = () => {
      avatarSpeak({ voice: parameters }, test.value);
    };

    // `shapeObject` is synchronous in Pinia (fires MQTT publish but
    // doesn't await it). The Vuex version was the same shape; Vuex's
    // dispatch just wrapped the undefined return in Promise.resolve(),
    // so the previous `.then(() => emit("close"))` ran on the next
    // microtask. Running the emit inline is functionally equivalent.
    const save = () => {
      stageStore.shapeObject({
        ...currentAvatar.value,
        voice: parameters,
      });
      emit("close");
    };

    return { save, parameters, voices, variants, test, testVoice };
  },
};
</script>

<template>
  <div v-if="!modelValue" class="card-header">
    <span class="card-header-title">{{ $t("voice_setting") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <a-form-item label="Voice" :label-col="{ span: 4 }" class="mb-2">
      <a-select v-model:value="parameters.voice" placeholder="No voice" :options="voices" />
    </a-form-item>

    <template v-if="parameters.voice">
      <a-form-item label="Variant" :label-col="{ span: 4 }" class="mb-2">
        <a-select v-model:value="parameters.variant" :options="variants" />
      </a-form-item>

      <a-form-item label="Pitch" :label-col="{ span: 4 }" class="mb-2">
        <a-slider v-model:value="parameters.pitch" :max="50" />
      </a-form-item>

      <a-form-item label="Rate" :label-col="{ span: 4 }" class="mb-2">
        <a-slider v-model:value="parameters.speed" :max="175" />
      </a-form-item>
      <a-form-item label="Volume" :label-col="{ span: 4 }" class="mb-2">
        <a-slider v-model:value="parameters.amplitude" />
      </a-form-item>

      <a-form-item label="Test voice" :label-col="{ span: 4 }" class="mb-2">
        <a-input-search v-model:value="test" :placeholder="defaultTestMessage" @search="testVoice">
          <template #enterButton>
            <sound-outlined />
          </template>
        </a-input-search>
      </a-form-item>
    </template>
    <SaveButton v-if="!modelValue" @click="save" />
  </div>
</template>

<style lang="scss">
.card-footer-item {
  cursor: pointer;
}

.voice-parameters {
  .dropdown,
  .dropdown-trigger,
  .dropdown-trigger > button,
  .dropdown-menu {
    width: 100%;
  }
}

.ant-select-dropdown {
  z-index: 5000 !important;
}
</style>
