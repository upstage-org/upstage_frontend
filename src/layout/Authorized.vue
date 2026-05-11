<script setup lang="ts">
import { useRoute } from "vue-router";
import Sidebar from "components/Sidebar.vue";
import { useConfigStore } from "@stores/pinia/config";
import { storeToRefs } from "pinia";

const route = useRoute();
const { enableDonate } = storeToRefs(useConfigStore());

defineExpose({ enableDonate });
</script>

<template>
  <a-layout>
    <Sidebar />
    <a-layout
      class="h-screen space-y-2 p-2"
      :style="{ background: route?.meta?.background as string | undefined }"
    >
      <router-view />
    </a-layout>
  </a-layout>
</template>
