<!--
  Parent (MediaForm) passes `voice` as a shared reactive object so this
  child writes back into voice.voice / variant / pitch / speed / amplitude
  via v-model and Object.assign. Refactoring to emit-based v-models would
  require parallel changes in MediaForm and is out of scope for this lint
  pass. The vue/no-mutating-props warnings on these mutations are silenced
  at the file level.
-->
<!-- eslint-disable vue/no-mutating-props -->
<script lang="ts" setup>
import { PropType, ref } from "vue";
import { AvatarVoice } from "models/studio";
import { avatarSpeak } from "services/speech";
import { getVoiceList, getVariantList, defaultTestMessage } from "services/speech/voice";
import VoicePicker from "./VoicePicker.vue";

const props = defineProps({
  voice: {
    type: Object as PropType<AvatarVoice>,
    required: true,
  },
});

const test = ref("");
const testVoice = () => {
  avatarSpeak({ voice: props.voice }, test.value || defaultTestMessage);
};

const handleVoicePicked = (voice: AvatarVoice) => {
  Object.assign(props.voice, voice);
};
</script>

<template>
  <!-- eslint-disable vue/no-mutating-props -->
  <a-form-item label="Voice" :label-col="{ span: 3 }" class="mb-2">
    <div class="flex">
      <a-select
        v-model:value="props.voice.voice"
        placeholder="No voice"
        :options="getVoiceList()"
      />
      <VoicePicker @change="handleVoicePicked" />
    </div>
  </a-form-item>
  <template v-if="props.voice.voice">
    <a-form-item label="Variant" :label-col="{ span: 3 }" class="mb-2">
      <a-select v-model:value="props.voice.variant" :options="getVariantList()" />
    </a-form-item>
    <a-form-item label="Pitch" :label-col="{ span: 3 }" class="mb-2">
      <a-slider v-model:value="props.voice.pitch" />
    </a-form-item>
    <a-form-item label="Rate" :label-col="{ span: 3 }" class="mb-2">
      <a-slider
        :value="props.voice.speed / 3.5"
        @change="props.voice.speed = Number($event) * 3.5"
      />
    </a-form-item>
    <a-form-item label="Volume" :label-col="{ span: 3 }" class="mb-2">
      <a-slider v-model:value="props.voice.amplitude" />
    </a-form-item>
    <a-form-item label="Test voice" :label-col="{ span: 3 }" class="mb-2">
      <a-input-search v-model:value="test" :placeholder="defaultTestMessage" @search="testVoice">
        <template #enterButton>
          <sound-outlined />
        </template>
      </a-input-search>
    </a-form-item>
  </template>
</template>
