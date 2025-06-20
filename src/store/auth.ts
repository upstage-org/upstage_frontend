import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuthStore = defineStore('auth', () => {
  const isLoggedIn = ref(false)

  const loggedIn = computed(() => isLoggedIn.value)

  function setLoggedIn(value: boolean) {
    isLoggedIn.value = value
  }

  return {
    loggedIn,
    setLoggedIn
  }
}) 