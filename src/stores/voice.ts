import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { avatarSpeak } from 'services/speech'
import {
  getDefaultVariant,
  getVariantList,
  getVoiceList,
} from 'services/speech/voice'

export const useVoiceStore = defineStore('voice', () => {
  const voices = getVoiceList()
  const variants = getVariantList()
  const currentVoice = ref({
    voice: '',
    variant: getDefaultVariant(),
    pitch: 0,
    speed: 100,
    amplitude: 1
  })

  const testMessage = ref('Welcome to UpStage!')

  const testVoice = () => {
    avatarSpeak({ voice: currentVoice.value }, testMessage.value)
  }

  const updateVoice = (voice: any) => {
    currentVoice.value = voice
  }

  return {
    voices,
    variants,
    currentVoice,
    testMessage,
    testVoice,
    updateVoice
  }
}) 