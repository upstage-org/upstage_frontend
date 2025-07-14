import { defineStore } from 'pinia'
import { ref } from 'vue'

export const usePaymentStore = defineStore('payment', () => {
  const amount = ref<number | null>(null)

  const openPurchasePopup = (type, amount, title) => {
    // TODO: Implement the actual purchase popup logic
    // This would replace the existing Vuex action
    console.log('Opening purchase popup:', { type, amount, title })
  }

  return {
    amount,
    openPurchasePopup
  }
}) 