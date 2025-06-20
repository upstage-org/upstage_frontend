import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { paymentGraph } from 'services/graphql'
import { useMutation } from 'services/graphql/composable'
import { message } from 'ant-design-vue'
import { loadStripe } from '@stripe/stripe-js'
import config from 'config'

export const usePaymentStore = defineStore('payment', () => {
  // State
  const isPurchasePopupActive = ref(false)
  const isReceiptPopupActive = ref(false)
  const isReceiptFormActive = ref(false)
  const purchaseTitle = ref('')
  const purchaseAmount = ref(0)
  const loading = ref(false)
  const generating = ref(false)
  const clientSecret = ref(null)
  const donorName = ref('')
  const donationDetails = ref({
    amount: 0,
    date: ''
  })
  const stripe = ref(null)

  // Getters
  const title = computed(() => purchaseTitle.value)
  const amount = computed(() => purchaseAmount.value)

  // Actions
  const initializeStripe = async () => {
    stripe.value = await loadStripe(config.STRIPE_KEY)
  }

  const openPurchasePopup = (title, amount) => {
    purchaseTitle.value = title
    purchaseAmount.value = amount
    isPurchasePopupActive.value = true
  }

  const closePurchasePopup = () => {
    isPurchasePopupActive.value = false
    purchaseTitle.value = ''
    purchaseAmount.value = 0
  }

  const openReceiptPopup = (details) => {
    donationDetails.value = details
    isReceiptPopupActive.value = true
  }

  const closeReceiptPopup = () => {
    isReceiptPopupActive.value = false
    donationDetails.value = { amount: 0, date: '' }
  }

  const openReceiptForm = () => {
    isReceiptPopupActive.value = false
    isReceiptFormActive.value = true
  }

  const closeReceiptForm = () => {
    isReceiptFormActive.value = false
    donorName.value = ''
  }

  const { mutation: paymentSecret } = useMutation(paymentGraph.paymentSecret)
  const { mutation: generateReceiptMutation } = useMutation(paymentGraph.generateReceipt)

  const getPaymentSecret = async (amount) => {
    loading.value = true
    try {
      const res = await paymentSecret({
        amount: parseFloat(amount) * 100,
      })
      if (res.paymentSecret) {
        clientSecret.value = res.paymentSecret
        return res.paymentSecret
      }
      throw new Error('Stripe Error!')
    } catch (error) {
      message.error(error.message)
      throw error
    } finally {
      loading.value = false
    }
  }

  const generateReceipt = async () => {
    try {
      generating.value = true
      const result = await generateReceiptMutation({
        receivedFrom: donorName.value,
        description: 'Donation',
        amount: donationDetails.value.amount.toString(),
        date: donationDetails.value.date
      })

      if (!result.generateReceipt) {
        throw new Error('Failed to generate receipt')
      }

      const { fileBase64, fileName } = result.generateReceipt
      const byteCharacters = atob(fileBase64)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      link.click()
      URL.revokeObjectURL(url)

      message.success('Receipt downloaded and sent!')
      closeReceiptForm()
    } catch (error) {
      message.error('Failed to generate receipt: ' + error.message)
      throw error
    } finally {
      generating.value = false
    }
  }

  return {
    // State
    isPurchasePopupActive,
    isReceiptPopupActive,
    isReceiptFormActive,
    loading,
    generating,
    clientSecret,
    donorName,
    donationDetails,
    stripe,
    // Getters
    title,
    amount,
    // Actions
    initializeStripe,
    openPurchasePopup,
    closePurchasePopup,
    openReceiptPopup,
    closeReceiptPopup,
    openReceiptForm,
    closeReceiptForm,
    getPaymentSecret,
    generateReceipt
  }
}) 