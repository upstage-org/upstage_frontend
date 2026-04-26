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
import { computed } from "vue";
import { useStore } from "vuex";
import Footer from "components/Footer.vue";
import NavBar from "components/NavBarHome.vue";
import OneTimePurchase from "components/payment/OneTimePurchase.vue";
import PurchasePopup from "components/payment/PurchasePopup.vue";

const store = useStore();
const enableDonate = computed<boolean>(() => store.getters["config/enableDonate"]);
</script>

<style>
#main-layout {
  min-height: calc(100vh - 120px);
}
</style>
