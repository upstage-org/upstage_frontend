import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useMutation } from 'services/graphql/composable'
import { stageGraph } from 'services/graphql'
import { message } from 'ant-design-vue'

interface Scene {
  id: string
  name: string
  scenePreview: string
  payload: string
}

export const useScenesStore = defineStore('scenes', () => {
  const scenes = ref<Scene[]>([])
  const currentSceneId = ref<string | null>(null)

  const loadScenes = async () => {
    // Implement scene loading logic here
    // This should fetch scenes from your API
  }

  const switchScene = async (sceneId: string) => {
    const scene = scenes.value.find(s => s.id === sceneId)
    if (!scene) return

    currentSceneId.value = sceneId
    const audios = JSON.parse(scene.payload).audios
    const audioPlayers = JSON.parse(scene.payload).audioPlayers

    audios.forEach((audio: any, index: number) => {
      audio.currentTime = audioPlayers[index].currentTime
      audio.changed = true
      audio.saken = true
      // You might want to dispatch this to an audio store instead
      // store.dispatch("stage/updateAudioStatus", audio)
    })
  }

  const deleteScene = async (sceneId: string) => {
    const { mutation } = useMutation(stageGraph.deleteScene, sceneId)
    const result = await mutation()
    
    if (result.deleteScene) {
      const { success } = result.deleteScene
      if (success) {
        message.success(result.deleteScene.message)
        await loadScenes()
      } else {
        message.error(result.deleteScene.message)
      }
    }
  }

  return {
    scenes,
    currentSceneId,
    loadScenes,
    switchScene,
    deleteScene
  }
}) 