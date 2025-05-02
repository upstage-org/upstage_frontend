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
import { useStore } from "vuex";

const store = useStore();
const router = useRouter();


const onLoginSuccess = () => {
  store.dispatch("user/fetchCurrent");
  store.dispatch("config/fetchConfig")
  router.push({ name: 'Stages' })
};
</script>

<style></style>
