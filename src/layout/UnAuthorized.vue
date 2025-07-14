<template>
  <NavBar />
  <div id="main-layout">
    <router-view />
    <OneTimePurchase v-if="enableDonate" />
    <PurchasePopup v-if="enableDonate" />
  </div>
  <Footer />
</template>

<script setup lang="ts">
import Footer from "components/Footer.vue";
import NavBar from "components/NavBarHome.vue";
import OneTimePurchase from "components/payment/OneTimePurchase.vue";
import PurchasePopup from "components/payment/PurchasePopup.vue";
import { useConfigStore } from "store/modules/config";
import { storeToRefs } from "pinia";

// Store initialization
const configStore = useConfigStore();
// const { enableDonate } = storeToRefs(configStore);
const enableDonate = true;
</script>

<style>
#main-layout {
  min-height: calc(100vh - 120px);
}
</style>