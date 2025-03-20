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
                <button class="button is-primary" type="submit" :class="{
                  'is-loading': loading,
                }" :disabled="loading">
                  <span>Donate $ {{ amount }}</span>
                </button>
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
import { loadStripe } from '@stripe/stripe-js'
import { StripeElements, StripeElement } from "vue-stripe-js"
import config from "config";

export default {
  components: { Icon, StripeElements, StripeElement },
  setup: () => {
    const store = useStore();
    const isActive = computed(() => store.state.stage.purchasePopup.isActive);
    const title = computed(() => store.state.stage.purchasePopup.title);
    const amount = computed(() => store.state.stage.purchasePopup.amount);
    const loading = ref(true);
    const clientSecret = ref();

    const close = () => {
      store.dispatch("stage/closePurchasePopup");
    };

    const stripe = ref(null)
    const elementsComponent = ref()
    const paymentComponent = ref()
    const stripeOptions = ref({
      // https://stripe.com/docs/js/initializing#init_stripe_js-options
    })
    const elementsOptions = ref({
      // https://stripe.com/docs/js/elements_object/create#stripe_elements-options
      mode: "payment",
      amount: 100,
      currency: "usd",
      appearance: {
        theme: "flat",
      },
    })
    const paymentElementOptions = ref({
      // https://docs.stripe.com/js/elements_object/create_payment_element#payment_element_create-options
    })

    onBeforeMount(async () => {
      stripe.value = await loadStripe(config.STRIPE_KEY)
    })

    const { mutation: paymentSecret } = useMutation(paymentGraph.paymentSecret);
    watch(
      () => isActive.value,
      async (newValue) => {
        if (newValue) {
          loading.value = true;
          await paymentSecret({
            amount: parseFloat(amount.value) * 100
          }).then((res) => {
            if (res.paymentSecret) {
              clientSecret.value = res.paymentSecret;
              loading.value = false;
            } else {
              message.error("Stripe Error!");
            }
          });
        }
      },
    );

    const donateToUpstage = async () => {
      try {
        loading.value = true;

        const stripeInstance = elementsComponent.value?.instance
        const elements = elementsComponent.value?.elements

        if (stripeInstance) {
          const res = await elements.submit();
          if (res.error) {
            message.error(res.error.message);
            return;
          }
          const { paymentIntent, error } = await stripeInstance.confirmPayment({
            elements,
            clientSecret: clientSecret.value,
            confirmParams: {
              return_url: window.location.href,
            },
            redirect: 'if_required'
          })
          console.log("**paymentIntent:", paymentIntent)
          loading.false = false;
          if (error) {
            message.error("Donate to Upstage failure!");
          } else {
            message.success("Donate to Upstage success!");
            close();
          }
        }
      } catch (error) {
        message.error(error);
      } finally {
        loading.value = false;
      }
    }
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
      paymentComponent
    };
  }
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
</style>
