<template>
  <transition name="fade">
    <div class="modal" :class="{ 'is-active': isPurchasePopupActive }">
      <div class="modal-background" @click="closePurchasePopup"></div>
      <div class="modal-content">
        <div class="card">
          <a href="#" class="card-header-icon" @click="closePurchasePopup">
            <span class="icon">
              <Icon src="close.svg" />
            </span>
          </a>
          <div class="card-header">
            <span class="card-header-title">{{ title }}</span>
          </div>
          <div class="card-content">
            <form v-if="isPurchasePopupActive" @submit.prevent="donateToUpstage">
              <StripeElements :stripe-key="stripeKey" :instance-options="stripeOptions"
                :elements-options="elementsOptions" ref="elementsComponent">
                <StripeElement type="payment" :options="paymentElementOptions" ref="paymentComponent" />
              </StripeElements>
              <br />
              <div class="button-purchase">
                <button class="button is-primary" type="submit" :class="{ 'is-loading': loading }" :disabled="loading">
                  <span>Donate USD$ {{ amount }}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </transition>
  <transition name="fade">
    <div class="modal" :class="{ 'is-active': isReceiptPopupActive }" v-if="isReceiptPopupActive">
      <div class="modal-background" @click="closeReceiptPopup"></div>
      <div class="modal-content">
        <div class="card">
          <div class="card-header">
            <span class="card-header-title">Would you like a receipt?</span>
          </div>
          <div class="card-content">
            <div class="buttons">
              <button class="button is-primary" @click="openReceiptForm">Yes</button>
              <button class="button" @click="closeReceiptPopup">No</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </transition>

  <transition name="fade">
    <div class="modal" :class="{ 'is-active': isReceiptFormActive }" v-if="isReceiptFormActive">
      <div class="modal-background" @click="closeReceiptForm"></div>
      <div class="modal-content">
        <div class="card">
          <a href="#" class="card-header-icon" @click="closeReceiptForm">
            <span class="icon">
              <Icon src="close.svg" />
            </span>
          </a>
          <div class="card-header">
            <span class="card-header-title">Donation Receipt</span>
          </div>
          <div class="card-content">
            <form @submit.prevent="generateReceipt">
              <div class="field">
                <label class="label">Received from</label>
                <div class="control">
                  <input class="input" type="text" v-model="donorName" required />
                </div>
              </div>
              <div class="field">
                <label class="label">Amount</label>
                <div class="control">
                  <input class="input" type="text" :value="`$${donationDetails.amount}`" disabled />
                </div>
              </div>
              <div class="field">
                <label class="label">Date</label>
                <div class="control">
                  <input class="input" type="text" :value="donationDetails.date" disabled />
                </div>
              </div>
              <div class="field">
                <label class="label">Description</label>
                <div class="control">
                  <input class="input" type="text" value="Donation" disabled />
                </div>
              </div>
              <div class="buttons">
                <button class="button is-primary" type="submit" :class="{ 'is-loading': generating }"
                  :disabled="generating">
                  Download PDF
                </button>
                <button class="button" @click="closeReceiptForm">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script setup>
import { ref, onBeforeMount, watch } from 'vue'
import { usePayment } from 'composables/usePayment'
import Icon from 'components/Icon.vue'
import { StripeElements, StripeElement } from 'vue-stripe-js'
import { message } from 'ant-design-vue'
import config from 'config'

const {
  isPurchasePopupActive,
  isReceiptPopupActive,
  isReceiptFormActive,
  loading,
  generating,
  clientSecret,
  donorName,
  donationDetails,
  title,
  amount,
  closePurchasePopup,
  closeReceiptPopup,
  openReceiptForm,
  closeReceiptForm,
  getPaymentSecret,
  generateReceipt,
  initializeStripe
} = usePayment()

// Component refs
const elementsComponent = ref()
const paymentComponent = ref()

// Stripe configuration
const stripeKey = config.STRIPE_KEY
const stripeOptions = ref({})
const elementsOptions = ref({
  mode: 'payment',
  amount: 100,
  currency: 'usd',
  appearance: { theme: 'flat' },
})
const paymentElementOptions = ref({})

// Initialize Stripe
onBeforeMount(async () => {
  await initializeStripe()
})

// Watch for popup activation to get payment secret
watch(
  () => isPurchasePopupActive,
  async (newValue) => {
    if (newValue) {
      try {
        await getPaymentSecret(amount.value)
      } catch (error) {
        message.error('Failed to initialize payment')
      }
    }
  }
)

// Handle donation submission
const donateToUpstage = async () => {
  try {
    loading.value = true
    const stripeInstance = elementsComponent.value?.instance
    const elements = elementsComponent.value?.elements

    if (stripeInstance) {
      const res = await elements.submit()
      if (res.error) {
        message.error(res.error.message)
        return
      }
      const { paymentIntent, error } = await stripeInstance.confirmPayment({
        elements,
        clientSecret: clientSecret.value,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      })
      loading.value = false
      if (error) {
        message.error('Donate to UpStage failure!')
      } else {
        message.success('Donate to UpStage success!')
        closePurchasePopup()
        paymentStore.openReceiptPopup({
          amount: amount.value,
          date: new Date().toLocaleDateString(),
        })
      }
    }
  } catch (error) {
    message.error(error.message)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped lang="scss">
.card-icon {
  position: absolute;
  display: block;
  height: 100%;
  line-height: 40px;
}

.card-input {
  position: inherit;
  display: block;
  margin-left: 1.5rem;
  border: none;
  background-color: transparent;
  width: calc(100% - 1.5rem);
  font-family: inherit;
}

.card-input:focus {
  border-color: inherit;
  -webkit-box-shadow: none;
  box-shadow: none;
}

.block-input {
  margin-bottom: 18px;
}

.card-secret-info {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.button-purchase {
  display: grid;
  grid-template-columns: 1fr;
}

.card-header-icon {
  position: absolute;
  right: 0;
}

.modal {
  z-index: 1000;
}

.buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
