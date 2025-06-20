<template>
  <audio v-for="(audio, index) in audioStore.audios" :key="index" :ref="setRef" preload="auto">
    <source :src="audio.src" type="audio/mpeg" />
    <source :src="audio.src" type="audio/ogg" />
    <source :src="audio.src" type="audio/wav" />
    <source :src="audio.src" type="audio/x-aiff" />
    <object>
      <param name="src" :value="audio.src" />
      <param name="controller" value="false" />
      <embed :src="audio.src" controller="false" type="audio/mpeg" />
    </object>
  </audio>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useAudioStore } from '../../stores/audio'
import type { AudioState } from '../../stores/audio'

const audioStore = useAudioStore()
let refs: HTMLAudioElement[] = []

const stopAudio = (audio: AudioState, index: number) => {
  audioStore.updateAudioStatus({
    ...audio,
    index,
    isPlaying: false,
    currentTime: 0
  })
}

const setRef = (el: any) => {
  if (!el || !(el instanceof HTMLAudioElement)) return

  const index = refs.length
  refs.push(el)

  el.addEventListener('ended', () => {
    const audio = audioStore.audios[index]
    if (audio.loop) {
      el.currentTime = 0
      el.play()
    } else {
      stopAudio(audio, index)
      el.currentTime = 0
    }
  })

  el.addEventListener('loadedmetadata', () => {
    audioStore.updateAudioPlayerStatus({
      index,
      duration: el.duration
    })
  })

  el.addEventListener('timeupdate', () => {
    audioStore.updateAudioPlayerStatus({
      index,
      currentTime: el.currentTime
    })
  })
}

const handleAudioChange = () => {
  audioStore.audios.forEach((audio: AudioState, i: number) => {
    if (audio.changed) {
      if (audio.isPlaying) {
        refs[i].playbackRate = audioStore.speed
        refs[i].play()
      } else {
        refs[i].pause()
      }
      if (audio.saken) {
        refs[i].currentTime = audio.currentTime ?? 0
      }
      audioStore.fadeVolume(refs[i], audio.volume ?? 1)
      audio.changed = false
      audio.saken = false
    }
  })
}

watch(() => audioStore.audios, handleAudioChange)
onMounted(handleAudioChange)
</script>

<style scoped>
audio {
  display: none;
}
</style>
