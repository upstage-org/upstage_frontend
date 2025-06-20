import { defineStore } from 'pinia'
import { ref } from 'vue'

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

export const useAvatarsStore = defineStore('avatars', () => {
  const avatars = ref<Avatar[]>([])

  const setAvatars = (newAvatars: Avatar[]) => {
    avatars.value = newAvatars
  }

  return {
    avatars,
    setAvatars
  }
}) 