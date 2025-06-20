import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

interface BackgroundFrame {
  src: string
  opacity?: number
  speed?: number
  frames?: string[]
  currentFrame?: string
  multi?: boolean
}

export const useBackgroundStore = defineStore('background', () => {
  const background = ref<BackgroundFrame | null>(null)
  const currentFrame = ref<string | null>(null)
  const frameInterval = ref<number | null>(null)

  const backgroundOpacity = computed(() => background.value?.opacity ?? 1)
  const transitionDuration = computed(() => (background.value?.speed || 0) * 1000)

  function setBackground(newBackground: BackgroundFrame | null) {
    if (background.value) {
      clearInterval(frameInterval.value!)
    }

    background.value = newBackground
    currentFrame.value = newBackground?.currentFrame ?? newBackground?.src ?? null

    if (newBackground?.frames && newBackground.speed && newBackground.speed > 0) {
      frameInterval.value = window.setInterval(() => {
        if (!newBackground.frames) return
        const currentIndex = newBackground.frames.indexOf(currentFrame.value!)
        const nextIndex = (currentIndex + 1) % newBackground.frames.length
        currentFrame.value = newBackground.frames[nextIndex]
      }, newBackground.speed * 1000)
    }
  }

  return {
    background,
    currentFrame,
    backgroundOpacity,
    transitionDuration,
    setBackground
  }
}) 