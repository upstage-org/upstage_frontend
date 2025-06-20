<template>
  <div v-if="saved">
    <router-link :to="`/replay/${stage.fileLocation}/${saved.id}`" class="button is-small is-light is-success">
      <span class="icon is-small">
        <i class="fas fa-play"></i>
      </span>
      <span>{{ saved.name }}</span>
    </router-link>
  </div>
  <div v-else-if="stage.activeRecording" class="field has-addons">
    <p class="control">
      <a-tooltip title="Stop recording">
        <button @click="handleSaveRecording" class="button is-small is-light is-danger">
          <Loading v-if="saving" height="24px" />
          <span v-else class="icon is-small">
            <i class="fas fa-stop"></i>
          </span>
          <span>{{ recordingLabel }}</span>
        </button>
      </a-tooltip>
    </p>
    <p class="control">
      <CustomConfirm @confirm="handleDeleteRecording" :loading="deleting">
        <template #trigger>
          <button class="button is-small is-light is-dark">
            <span class="icon is-small">
              <Icon src="delete.svg" />
            </span>
          </button>
        </template>
        <div class="has-text-centered">
          Are you sure you want to delete this recording without saving?
        </div>
      </CustomConfirm>
    </p>
  </div>
  <template v-else>
    <CustomConfirm @confirm="handleStartRecording" :loading="loading">
      <Field v-model="form.name" label="Name" placeholder="Give your recording a name" required />
      <p>
        <i class="fas fa-exclamation-triangle has-text-warning"></i>
        By starting a recording, you acknowledge that the stage
        <span class="has-text-danger">will be cleared!</span> You might wish to
        save your scene before proceed.
      </p>
      <template #no>{{ $t("cancel") }}</template>
      <template #yes>
        <span class="mr-2">
          <i class="fas fa-video"></i>
        </span>
        <span>{{ $t("start_recording") }}</span>
      </template>
      <template #trigger>
        <a-tooltip title="Start recording">
          <button class="button is-light is-small">
            <i class="fas fa-video has-text-primary"></i>
          </button>
        </a-tooltip>
      </template>
    </CustomConfirm>
    <a-tooltip title="View recordings">
      <router-link :to="`/stage-management/${stage.id}/archive`" class="button is-small is-light is-success">
        <span class="icon is-small">
          <i class="fas fa-list"></i>
        </span>
      </router-link>
    </a-tooltip>
  </template>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import CustomConfirm from 'components/CustomConfirm.vue'
import Loading from 'components/Loading.vue'
import Field from 'components/form/Field.vue'
import Icon from 'components/Icon.vue'
import { useRecordingStore } from 'stores/recording'

const props = defineProps<{
  stage: {
    id: string
    fileLocation: string
    activeRecording: any
  }
}>()

const recordingStore = useRecordingStore()
const form = reactive({
  name: '',
})

const { loading, saving, deleting, saved, getRecordingDuration } = recordingStore

const recordingLabel = computed(() => {
  const recording = props.stage.activeRecording
  if (recording) {
    return `${recording.name} - ${getRecordingDuration(recording)}`
  }
  return ''
})

const handleStartRecording = async (complete: () => void) => {
  await recordingStore.startRecording(props.stage.id, form.name, props.stage.fileLocation)
  complete()
}

const handleSaveRecording = async () => {
  await recordingStore.saveRecording(props.stage.activeRecording.id)
}

const handleDeleteRecording = async (complete: () => void) => {
  await recordingStore.deleteRecording(props.stage.activeRecording.id)
  complete()
}
</script>

<style scoped>
.has-addons {
  justify-content: center !important;
}
</style>
