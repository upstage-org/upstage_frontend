import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

interface StageSize {
  width: number
  height: number
  left: number
  top: number
}

interface StageObject {
  id: string
  type?: string
  drawingId?: string
  x: number
  y: number
}

interface ChatMessage {
  user: string
  message: string
  clear?: boolean
}

interface PrivateMessage {
  user: string
  message: string
  clearPlayerChat?: boolean
}

interface ChatState {
  messages: ChatMessage[]
  privateMessages: PrivateMessage[]
  opacity: number
  fontSize: string
}

interface Room {
  type: string
  name: string
  description: string
  w: number
  h: number
}

interface StreamConfig {
  type: string
  jitsi: boolean
  name: string
  description?: string
  w: number
  h: number
}

interface Audio {
  currentTime: number
  saken: boolean
  isPlaying: boolean
}

interface Avatar {
  id: string
  name: string
  type: string
  drawingId?: string
  content?: string
  w?: number
  src?: string
  displayName?: string
  multi?: boolean
  holder?: { id: string }
}

export const useStageStore = defineStore('stage', () => {
  const audios = ref<Audio[]>([])

  const stopAudio = (audio: Audio) => {
    audio.currentTime = 0
    audio.saken = true
    audio.isPlaying = false
  }

  const blankScene = () => {
    // Add your blank scene logic here
    audios.value.forEach(audio => {
      stopAudio(audio)
    })
  }

  return {
    audios,
    stopAudio,
    blankScene
  }
}) 