import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useChatStore = defineStore('chat', () => {
  const messages = ref([])
  const session = ref(null)
  const canPlay = ref(false)

  const removeChat = async (messageId) => {
    // Implement your remove chat logic here
    messages.value = messages.value.filter(msg => msg.id !== messageId)
  }

  const highlightChat = async (messageId) => {
    if (canPlay.value) {
      const message = messages.value.find(msg => msg.id === messageId)
      if (message) {
        message.highlighted = !message.highlighted
      }
    }
  }

  return {
    messages,
    session,
    canPlay,
    removeChat,
    highlightChat
  }
}) 