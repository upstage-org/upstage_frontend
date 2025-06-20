import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useToolboxStore = defineStore('toolbox', () => {
  const activeTool = ref<string | undefined>()
  const activeMovable = ref<any>(null)

  const isScene = computed(() => activeTool.value === 'Scene')

  function changeTool(newTool: string | undefined) {
    if (activeTool.value === newTool) {
      activeTool.value = undefined
    } else {
      activeTool.value = newTool
    }
    activeMovable.value = null
  }

  function setActiveMovable(movable: any) {
    activeMovable.value = movable
  }

  return {
    activeTool,
    activeMovable,
    isScene,
    changeTool,
    setActiveMovable
  }
}) 