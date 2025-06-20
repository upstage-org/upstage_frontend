import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUserStore = defineStore('user', () => {
  const avatarId = ref<string | null>(null)
  const chatname = ref<string>('')
  const loadingUser = ref(false)

  const setAvatarId = (id: string) => {
    avatarId.value = id
  }

  const saveNickname = async (form: { nickname: string }) => {
    // Here you would typically make an API call
    chatname.value = form.nickname
    return chatname.value
  }

  function setLoadingUser(value: boolean) {
    loadingUser.value = value
  }

  return {
    avatarId,
    chatname,
    setAvatarId,
    saveNickname,
    loadingUser,
    setLoadingUser
  }
}) 