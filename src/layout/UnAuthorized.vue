<script setup lang="ts">
import Footer from "components/Footer.vue";
import NavBar from "components/NavBarHome.vue";
import { defineAsyncComponent } from "vue";
import { useConfigStore } from "@stores/pinia/config";
import { storeToRefs } from "pinia";

// Async chunks: these pull in Stripe.js + vue-stripe-js, which no public
// page needs until someone opens the donate popup. Loading them after the
// page has rendered keeps the ~200 KB Stripe bundle off the critical path.
const OneTimePurchase = defineAsyncComponent(
  () => import("components/payment/OneTimePurchase.vue"),
);
const PurchasePopup = defineAsyncComponent(() => import("components/payment/PurchasePopup.vue"));

const { enableDonate } = storeToRefs(useConfigStore());
</script>

<template>
  <NavBar />
  <div id="main-layout">
    <router-view />
    <OneTimePurchase v-if="enableDonate" />
    <PurchasePopup v-if="enableDonate" />
  </div>
  <Footer />
</template>

<style>
#main-layout {
  min-height: calc(100vh - 120px);
}
</style>
