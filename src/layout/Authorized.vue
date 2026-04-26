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

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import Sidebar from "components/Sidebar.vue";

const store = useStore();
const route = useRoute();
const enableDonate = computed<boolean>(() => store.getters["config/enableDonate"]);

defineExpose({ enableDonate });
</script>
