<script setup lang="ts">
import Footer from "components/Footer.vue";
import NavBar from "components/NavBarHome.vue";
import OneTimePurchase from "components/payment/OneTimePurchase.vue";
import PurchasePopup from "components/payment/PurchasePopup.vue";
import { useConfigStore } from "@stores/pinia/config";
import { storeToRefs } from "pinia";

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
