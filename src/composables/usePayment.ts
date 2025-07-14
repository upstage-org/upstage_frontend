import { ref, computed } from 'vue'
import { paymentGraph } from 'services/graphql'
import { useMutation } from 'services/graphql/composable'
import { message } from 'ant-design-vue'
import { loadStripe, Stripe } from '@stripe/stripe-js'
import config from 'config'
import { useStageStore } from 'store/modules/stage'

export function usePayment() {
  const stageStore = useStageStore()

  // State
  const loading = ref(false)
  const generating = ref(false)
  const isReceiptFormActive = ref(false);
  const clientSecret = ref<string | null>(null)
  const donorName = ref('')
  const stripe = ref<Stripe | null> (null)

  // Getters
  const title = computed(() => stageStore.purchasePopup.title || '')
  const amount = computed(() => stageStore.purchasePopup.amount || 0)
  const isPurchasePopupActive = computed(() => stageStore.purchasePopup.isActive)
  const isReceiptPopupActive = computed(() => stageStore.receiptPopup.isActive)  
  const donationDetails = computed(() => stageStore.receiptPopup.donationDetails || { amount: 0, date: '' })

  // Actions
  const initializeStripe = async () => {
    stripe.value = await loadStripe(config.STRIPE_KEY)
  }

  const openPurchasePopup = (title: string, amount: number, description: string = '') => {
    stageStore.openPurchasePopup({
      title,
      amount,
      description
    })
  }

  const closePurchasePopup = () => {
    stageStore.closePurchasePopup()
  }

  const openReceiptPopup = (details: any) => {
    stageStore.openReceiptPopup(details)
  }

  const closeReceiptPopup = () => {
    stageStore.closeReceiptPopup()
  }

  const openReceiptForm = () => {     
    closeReceiptPopup();
    isReceiptFormActive.value = true;
  }

  const closeReceiptForm = () => {
    isReceiptFormActive.value = false;
    donorName.value = '';
  }

  const { mutation: paymentSecret } = useMutation(paymentGraph.paymentSecret)
  const { mutation: generateReceiptMutation } = useMutation(paymentGraph.generateReceipt)

  const getPaymentSecret = async (amount: number) => {
    loading.value = true
    try {
      const res: any = await paymentSecret({
        amount: parseFloat(amount.toString()) * 100,
      })
      if (res?.paymentSecret) {
        clientSecret.value = res?.paymentSecret
        return res?.paymentSecret
      }
      throw new Error('Stripe Error!')
    } catch (error: any) {
      message.error(error.message)
      throw error
    } finally {
      loading.value = false
    }
  }

  const generateReceipt = async () => {
    try {
      generating.value = true
      const result: any  = await generateReceiptMutation({
        receivedFrom: donorName.value,
        description: 'Donation',
        amount: donationDetails.value.amount.toString(),
        date: donationDetails.value.date
      })

      if (!result?.generateReceipt) {
        throw new Error('Failed to generate receipt')
      }

      const { fileBase64, fileName } = result?.generateReceipt
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
    } catch (error: any ) {
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
}