import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

interface ChatMessage {
  message: string
  isPrivate: boolean
  timestamp: string
}

export const useChatStore = defineStore('chat', () => {
  // State
  const privateMessages = ref<ChatMessage[]>([])
  const privateMessage = ref('')
  const opacity = ref(1)
  const playerFontSize = ref('14px')
  const showPlayerChat = ref(true)

  // Actions
  const sendChat = async (message: string, isPrivate: boolean = true) => {
    if (message.trim()) {
      // TODO: Implement actual chat sending logic
      privateMessages.value.push({
        message,
        isPrivate,
        timestamp: new Date().toISOString()
      })
      privateMessage.value = ''
    }
  }

  const setPlayerChatParameters = (parameters: { 
    opacity?: number,
    playerFontSize?: string 
  }) => {
    if (parameters.opacity !== undefined) {
      opacity.value = parameters.opacity
    }
    if (parameters.playerFontSize) {
      playerFontSize.value = parameters.playerFontSize
    }
  }

  const togglePlayerChat = (show: boolean) => {
    showPlayerChat.value = show
  }

  return {
    // State
    privateMessages,
    privateMessage,
    opacity,
    playerFontSize,
    showPlayerChat,

    // Actions
    sendChat,
    setPlayerChatParameters,
    togglePlayerChat
  }
}) 