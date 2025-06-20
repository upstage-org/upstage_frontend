<template>
  <div class="payment mb-4">
    <div class="columns is-vcentered">
      <div class="column"></div>
      <div class="column"></div>
      <h4 class="column is-2">Donate to UpStage (amounts shown in US dollars):</h4>
      <div id="choice-buttons" class="column is-5">
        <div>
          <span class="input-symbol-dollar"></span>
          <button class="button payment-button" @click="amount = 10">
            <span>10</span>
          </button>
        </div>
        <div>
          <span class="input-symbol-dollar"></span>
          <button class="button payment-button" @click="amount = 20">
            <span>20</span>
          </button>
        </div>
        <div>
          <span class="input-symbol-dollar"></span>
          <button class="button payment-button" @click="amount = 30">
            <span>30</span>
          </button>
        </div>
        <div>
          <span class="input-symbol-dollar"></span>
          <input ref="custom_amount" type="number" step="0.01" min="0" max="999999.99" class="button payment-button"
            placeholder="Custom" @input="handleInput" v-model="amount" />
        </div>
      </div>
      <div class="column">
        <button class="button is-primary is-fullwidth" @click="handlePurchase">
          <span>Donate to UpStage (amounts shown in US dollars)</span>
        </button>
      </div>
      <div class="column"></div>
      <div class="column"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { message } from 'ant-design-vue'
import { usePaymentStore } from '../../stores/payment'

const paymentStore = usePaymentStore()
const amount = ref<number | null>(null)

const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  amount.value = parseFloat(target.value)
}

const handlePurchase = () => {
  if (amount.value && amount.value !== 0) {
    paymentStore.openPurchasePopup(
      'OneTimePurchase',
      amount.value,
      'Donate to UpStage (amounts shown in US dollars)'
    )
    amount.value = null
  } else {
    message.warning('Please select amount to donate!')
  }
}
</script>

<style lang="scss" scoped>
.payment {
  width: 90%;
  margin-left: 5%;

  h4 {
    font-size: 1.25em;
    font-weight: 400;
    text-align: center;
    align-items: center;
  }

  .button {
    position: inherit;
  }

  .payment-button {
    width: 90%;
    font-family: inherit;
    margin-left: 5%;
    margin-right: 5%;
  }

  .input-symbol-dollar {
    position: relative;
    display: block;
  }

  .input-symbol-dollar::before {
    content: "$";
    position: absolute;
    display: block;
    height: 100%;
    top: 0;
    left: 10%;
    line-height: 40px;
  }
}

#choice-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 3fr;
}
</style>
