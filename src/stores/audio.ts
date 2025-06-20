import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { animate } from 'animejs'

interface Audio {
  file: string
  name: string
  isPlaying: boolean
  currentTime: number
  volume: number
  loop: boolean
  saken?: boolean
}

export const useAudioStore = defineStore('audio', () => {
  const audios = ref<Audio[]>([])
  const audioPlayers = ref<HTMLAudioElement[]>([])
  const replaySpeed = ref(1)
  const isReplaying = ref(false)

  const speed = computed(() => {
    if (isReplaying.value) {
      return Math.min(replaySpeed.value, 8)
    }
    return 1
  })

  const updateAudioStatus = (audio: Audio) => {
    const index = audios.value.findIndex(a => a.file === audio.file)
    if (index !== -1) {
      audios.value[index] = { ...audios.value[index], ...audio }
    }
  }

  const togglePlaying = (audio: Audio, currentTime?: number) => {
    const updatedAudio = {
      ...audio,
      isPlaying: !audio.isPlaying,
      currentTime: currentTime ?? audio.currentTime,
      saken: true
    }
    updateAudioStatus(updatedAudio)
  }

  const stopAudio = (audio: Audio) => {
    const updatedAudio = {
      ...audio,
      currentTime: 0,
      saken: true,
      isPlaying: false
    }
    updateAudioStatus(updatedAudio)
  }

  const toggleLoop = (audio: Audio, currentTime?: number) => {
    const updatedAudio = {
      ...audio,
      loop: !audio.loop,
      currentTime: currentTime ?? audio.currentTime
    }
    updateAudioStatus(updatedAudio)
  }

  const seek = (audio: Audio, time: number) => {
    const updatedAudio = {
      ...audio,
      currentTime: time,
      saken: true
    }
    updateAudioStatus(updatedAudio)
  }

  const setVolume = (audio: Audio, volume: number) => {
    const updatedAudio = {
      ...audio,
      volume
    }
    updateAudioStatus(updatedAudio)
  }

  const fadeVolume = (audio: HTMLAudioElement, volume: number) => {
    animate(audio, {
      volume,
      ease: 'linear'
    })
  }

  return {
    audios,
    audioPlayers,
    speed,
    isReplaying,
    replaySpeed,
    updateAudioStatus,
    togglePlaying,
    stopAudio,
    toggleLoop,
    seek,
    setVolume,
    fadeVolume
  }
}) 