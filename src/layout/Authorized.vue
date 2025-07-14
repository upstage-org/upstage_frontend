<template>
    <a-layout>
        <Sidebar />
        <a-layout class="h-screen space-y-2 p-2" :style="{ background: route?.meta?.background }">
            <router-view />
        </a-layout>
    </a-layout>
</template>

<script setup lang="ts">
import Sidebar from "components/Sidebar.vue";
import { ref, watchEffect } from "vue";
import { useRoute } from "vue-router";
import { useConfigStore } from "store/modules/config";

const configStore = useConfigStore();
const enableDonate = ref(false);
const route = useRoute();
watchEffect(() => {
    enableDonate.value = configStore.enableDonate;
});

</script>