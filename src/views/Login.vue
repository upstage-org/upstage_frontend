<template>
  <div class="columns is-mobile is-centered is-vcentered foyer-background">
    <div class="column is-three-quarters-mobile is-two-thirds-tablet is-half-desktop is-one-third-widescreen">
      <LoginForm @success="onLoginSuccess" />
    </div>
  </div>
</template>

<script setup lang="ts">
import LoginForm from "components/LoginForm.vue";
import { useRouter } from "vue-router";
import { useUserStore } from "store/modules/user";
import { useConfigStore } from "store/modules/config";

// Composables
const userStore = useUserStore();
const configStore = useConfigStore();
const router = useRouter();

// Methods
const onLoginSuccess = async () => {
  await userStore.fetchCurrent();
  await configStore.fetchConfig();
  router.push({ name: 'Stages' });
};
</script>

<style></style>
