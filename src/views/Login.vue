<script setup lang="ts">
import LoginForm from "components/LoginForm.vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "@stores/pinia/user";
import { useConfigStore } from "@stores/pinia/config";

const router = useRouter();
const route = useRoute();

/**
 * After login, return the user to the page they were trying to reach
 * before being bounced to /login (set as `?redirect=` by the auth-store
 * `logout()` and the route guard). Only same-origin internal paths are
 * honoured — anything that starts with `//` or includes a scheme is
 * dropped to avoid an open-redirect vector via crafted query strings.
 */
const safeRedirectTarget = (): string | null => {
  const raw = route.query.redirect;
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
};

const onLoginSuccess = () => {
  useUserStore().fetchCurrent();
  useConfigStore().fetchConfig();
  const target = safeRedirectTarget();
  if (target) {
    router.replace(target);
  } else {
    router.push({ name: "Stages" });
  }
};
</script>

<template>
  <div class="columns is-mobile is-centered is-vcentered foyer-background">
    <div
      class="column is-three-quarters-mobile is-two-thirds-tablet is-half-desktop is-one-third-widescreen"
    >
      <LoginForm @success="onLoginSuccess" />
    </div>
  </div>
</template>

<style></style>
