import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useStageStore = defineStore('stage', () => {
  const background = ref(null)
  const tools = ref({
    backdrops: []
  })

  const currentBackground = computed(() => background.value ?? {})

  function setBackground(newBackground) {
    background.value = newBackground
  }

  function setBackdrops(backdrops) {
    tools.value.backdrops = backdrops
  }

  return {
    background,
    tools,
    currentBackground,
    setBackground,
    setBackdrops
  }
}) 