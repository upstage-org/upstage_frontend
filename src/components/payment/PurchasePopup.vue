<template>
  <transition name="fade">
    <div class="modal" :class="{ 'is-active': isActive }">
      <div class="modal-background" @click="close"></div>
      <div class="modal-content">
        <div class="card">
          <a href="#" class="card-header-icon" @click="close">
            <span class="icon">
              <Icon src="close.svg" />
            </span>
          </a>
          <div class="card-header">
            <span class="card-header-title">{{ title }}</span>
          </div>
          <div class="card-content">
            <form v-if="isActive" @submit.prevent="donateToUpstage">
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
                  <input class="input" type="text" value="Donation" disabled/>
                </div>
              </div>
              <div class="buttons">
                <button class="button is-primary" type="submit" :class="{ 'is-loading': generating }" :disabled="generating">
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

<script>
import { computed, ref, watch, onBeforeMount } from "vue";
import { useStore } from "vuex";
import Icon from "components/Icon.vue";
import { paymentGraph } from "services/graphql";
import { useMutation } from "services/graphql/composable";
import { message } from "ant-design-vue";
import { loadStripe } from "@stripe/stripe-js";
import { StripeElements, StripeElement } from "vue-stripe-js";
import config from "config";

export default {
  components: { Icon, StripeElements, StripeElement },
  setup() {
    const store = useStore();
    const isActive = computed(() => store.state.stage.purchasePopup.isActive);
    const title = computed(() => store.state.stage.purchasePopup.title);
    const amount = computed(() => store.state.stage.purchasePopup.amount);
    const isReceiptPopupActive = computed(() => store.state.stage.receiptPopup.isActive);
    const donationDetails = computed(() => store.state.stage.receiptPopup.donationDetails);
    const loading = ref(false);
    const clientSecret = ref();
    const isReceiptFormActive = ref(false);
    const donorName = ref("");
    const generating = ref(false);

    const close = () => {
      store.dispatch("stage/closePurchasePopup");
    };

    const closeReceiptPopup = () => {
      store.dispatch("stage/closeReceiptPopup");
    };

    const openReceiptForm = () => {
      isReceiptPopupActive.value = false;
      isReceiptFormActive.value = true;
      closeReceiptPopup();
    };

    const closeReceiptForm = () => {
      isReceiptFormActive.value = false;
      donorName.value = "";
    };

    const stripe = ref(null);
    const elementsComponent = ref();
    const paymentComponent = ref();
    const stripeOptions = ref({});
    const elementsOptions = ref({
      mode: "payment",
      amount: 100,
      currency: "usd",
      appearance: { theme: "flat" },
    });
    const paymentElementOptions = ref({});

    onBeforeMount(async () => {
      stripe.value = await loadStripe(config.STRIPE_KEY);
    });

    const { mutation: paymentSecret } = useMutation(paymentGraph.paymentSecret);
    const { mutation: generateReceiptMutation } = useMutation(paymentGraph.generateReceipt);

    watch(
      () => isActive.value,
      async (newValue) => {
        if (newValue) {
          loading.value = true;
          await paymentSecret({
            amount: parseFloat(amount.value) * 100,
          }).then((res) => {
            if (res.paymentSecret) {
              clientSecret.value = res.paymentSecret;
              loading.value = false;
            } else {
              message.error("Stripe Error!");
            }
          });
        }
      }
    );

    const donateToUpstage = async () => {
      try {
        loading.value = true;
        const stripeInstance = elementsComponent.value?.instance;
        const elements = elementsComponent.value?.elements;

        if (stripeInstance) {
          const res = await elements.submit();
          if (res.error) {
            message.error(res.error.message);
            return;
          }
          const { paymentIntent, error } = await stripeInstance.confirmPayment({
            elements,
            clientSecret: clientSecret.value,
            confirmParams: { return_url: window.location.href },
            redirect: "if_required",
          });
          loading.value = false;
          if (error) {
            message.error("Donate to UpStage failure!");
          } else {
            message.success("Donate to UpStage success!");
            close();
            store.dispatch("stage/openReceiptPopup", {
              amount: amount.value,
              date: new Date().toLocaleDateString(),
            });
          }
        }
      } catch (error) {
        message.error(error.message);
      } finally {
        loading.value = false;
      }
    };

    const generateReceipt = async () => {
      try {
        generating.value = true;

        const result = await generateReceiptMutation({
          receivedFrom: donorName.value,
          description: "Donation",
          amount: donationDetails.value.amount.toString(),
          date: donationDetails.value.date
        });

        if (!result.generateReceipt) {
          throw new Error("Failed to generate receipt");
        }

        const { fileBase64, fileName } = result.generateReceipt;

        const byteCharacters = atob(fileBase64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);

        message.success("Receipt downloaded and sent!");
        closeReceiptForm();
      } catch (error) {
        message.error("Failed to generate receipt: " + error.message);
      } finally {
        generating.value = false;
      }
    };

    return {
      isActive,
      close,
      title,
      amount,
      loading,
      donateToUpstage,
      stripe,
      stripeKey: config.STRIPE_KEY,
      stripeOptions,
      elementsOptions,
      paymentElementOptions,
      elementsComponent,
      paymentComponent,
      isReceiptPopupActive,
      isReceiptFormActive,
      donationDetails,
      donorName,
      openReceiptForm,
      closeReceiptPopup,
      closeReceiptForm,
      generateReceipt,
      generating,
    };
  },
};
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

	card-input:focus {
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
