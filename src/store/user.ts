import { defineStore } from 'pinia'
import { ref } from 'vue'
import { message } from 'ant-design-vue'

export const useUserStore = defineStore('user', () => {
  const nickname = ref('')
  const avatarId = ref<string | null>(null)

  async function saveNickname(newNickname: string) {
    try {
      // TODO: Replace with actual API call
      nickname.value = newNickname || 'Guest'
      return nickname.value
    } catch (error) {
      message.error('Failed to save nickname')
      throw error
    }
  }

  async function fetchCurrent() {
    try {
      // TODO: Replace with actual API call to fetch current user
      return true
    } catch (error) {
      message.error('Failed to fetch user data')
      throw error
    }
  }

  function setAvatarId(id: string | null) {
    avatarId.value = id
  }

  return {
    nickname,
    avatarId,
    saveNickname,
    fetchCurrent,
    setAvatarId
  }
}) 