import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useMutation } from 'services/graphql/composable'
import { stageGraph } from 'services/graphql'
import moment from 'moment'
import humanizeDuration from 'humanize-duration'
import { notification } from 'utils/notification'
import { useClearStage } from 'components/stage/composable'

export const useRecordingStore = defineStore('recording', () => {
  const loading = ref(false)
  const saving = ref(false)
  const deleting = ref(false)
  const saved = ref(false)
  const now = ref(moment())
  const interval = ref<number | null>(null)

  const { save: startRecordingMutation } = useMutation(stageGraph.startRecording)
  const { save: saveRecordingMutation } = useMutation(stageGraph.saveRecording)
  const { save: deleteRecordingMutation } = useMutation(stageGraph.deletePerformance)

  const startRecording = async (stageId: string, name: string, fileLocation: string) => {
    loading.value = true
    const clearStage = useClearStage(fileLocation)
    await clearStage()
    await startRecordingMutation('Recording started!', stageId, name)
    startTimer()
    loading.value = false
  }

  const saveRecording = async (recordingId: string) => {
    saving.value = true
    await saveRecordingMutation(() => {
      notification.success('Recording saved successfully!')
      saved.value = true
      stopTimer()
    }, recordingId)
    saving.value = false
  }

  const deleteRecording = async (recordingId: string) => {
    deleting.value = true
    await deleteRecordingMutation('Recording deleted successfully!', recordingId)
    deleting.value = false
  }

  const startTimer = () => {
    interval.value = window.setInterval(() => {
      now.value = moment()
    }, 1000)
  }

  const stopTimer = () => {
    if (interval.value) {
      clearInterval(interval.value)
      interval.value = null
    }
  }

  const getRecordingDuration = (recording: any) => {
    if (recording) {
      const from = moment.utc(recording.createdOn)
      return humanizeDuration(now.value.diff(from, 'milliseconds'), {
        round: true,
      })
    }
    return ''
  }

  return {
    loading,
    saving,
    deleting,
    saved,
    now,
    startRecording,
    saveRecording,
    deleteRecording,
    getRecordingDuration,
    startTimer,
    stopTimer
  }
}) 