<template>
  <div v-if="!modelValue" class="card-header">
    <span class="card-header-title">{{ $t("voice_setting") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <a-form-item label="Voice" :labelCol="{ span: 4 }" class="mb-2">
      <a-select v-model:value="voiceStore.currentVoice.voice" placeholder="No voice" :options="voiceStore.voices" />
    </a-form-item>

    <template v-if="voiceStore.currentVoice.voice">
      <a-form-item label="Variant" :labelCol="{ span: 4 }" class="mb-2">
        <a-select v-model:value="voiceStore.currentVoice.variant" :options="voiceStore.variants" />
      </a-form-item>

      <a-form-item label="Pitch" :labelCol="{ span: 4 }" class="mb-2">
        <a-slider v-model:value="voiceStore.currentVoice.pitch" :max="50" />
      </a-form-item>

      <a-form-item label="Rate" :labelCol="{ span: 4 }" class="mb-2">
        <a-slider v-model:value="voiceStore.currentVoice.speed" :max="175" />
      </a-form-item>
      <a-form-item label="Volume" :labelCol="{ span: 4 }" class="mb-2">
        <a-slider v-model:value="voiceStore.currentVoice.amplitude" />
      </a-form-item>

      <a-form-item label="Test voice" :labelCol="{ span: 4 }" class="mb-2">
        <a-input-search :placeholder="defaultTestMessage" v-model:value="voiceStore.testMessage"
          @search="voiceStore.testVoice">
          <template #enterButton>
            <sound-outlined />
          </template>
        </a-input-search>
      </a-form-item>
    </template>
    <SaveButton v-if="!modelValue" @click="save" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import SaveButton from 'components/form/SaveButton.vue'
import { useVoiceStore } from 'stores/voice'
import { useStageStore } from 'store'

const props = defineProps<{
  modelValue?: any
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:modelValue', value: any): void
}>()

const stageStore = useStageStore()
const voiceStore = useVoiceStore()
const currentAvatar = computed(() => stageStore.currentAvatar)

const defaultTestMessage = 'Welcome to UpStage!'

onMounted(() => {
  if (props.modelValue) {
    voiceStore.updateVoice(props.modelValue)
  } else if (currentAvatar.value?.voice) {
    voiceStore.updateVoice(currentAvatar.value.voice)
  }
})

const save = () => {
  stageStore.shapeObject({
    ...currentAvatar.value,
    voice: voiceStore.currentVoice,
  })
  emit("close")
}
</script>

<style lang="scss">
.card-footer-item {
  cursor: pointer;
}

.voice-parameters {

  .dropdown,
  .dropdown-trigger,
  .dropdown-trigger>button,
  .dropdown-menu {
    width: 100%;
  }
}

.ant-select-dropdown {
  z-index: 5000 !important;
}
</style>
