<script setup lang="ts">
import { ref, watch } from "vue";
import { storeToRefs } from "pinia";
import Turnstile from "vue-turnstile";
import configs from "config";
import { useAuthStore } from "@stores/pinia/auth";

/**
 * Shown to a player whose login ended while the stage is open. Logging in
 * here replaces the dead tokens inside the running session: no reload, no
 * navigation, the stage and its connections are untouched.
 *
 * Deliberately not a modal: no backdrop and no focus grab, so a player in
 * the middle of an action (dragging, typing in the chat) is not stopped.
 */
const authStore = useAuthStore();
const { sessionEndDeferred, reauthDismissed, username } = storeToRefs(authStore);

const isProduction = configs.MODE === "Production";
const siteKey = configs.CLOUDFLARE_CAPTCHA_SITEKEY ?? "";

const password = ref("");
const captchaToken = ref("");
const loading = ref(false);
const error = ref("");
const captcha = ref<{ reset?: () => void } | null>(null);

watch(sessionEndDeferred, () => {
  password.value = "";
  error.value = "";
});

const submit = async () => {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    await authStore.reauthenticate(password.value, captchaToken.value || undefined);
    password.value = "";
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    // A captcha token is good for one attempt: ask the widget for another.
    captchaToken.value = "";
    captcha.value?.reset?.();
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <template v-if="sessionEndDeferred">
    <button
      v-if="reauthDismissed"
      class="button is-small is-warning reauth-reopen"
      data-testid="reauth-reopen"
      @click="authStore.requestReauth()"
    >
      <span class="icon is-small"><i class="fas fa-lock"></i></span>
      <span>{{ $t("log_in_again") }}</span>
    </button>
    <form v-else class="card reauth-prompt" data-testid="reauth-prompt" @submit.prevent="submit">
      <header class="card-header">
        <p class="card-header-title">{{ $t("session_expired_on_stage") }}</p>
      </header>
      <div class="card-content">
        <p class="mb-3">{{ $t("session_expired_on_stage_hint") }}</p>
        <div class="field">
          <p class="control has-icons-left">
            <input
              class="input"
              name="username"
              autocomplete="username"
              :value="username"
              readonly
              tabindex="-1"
            />
            <span class="icon is-small is-left"><i class="fas fa-user"></i></span>
          </p>
        </div>
        <div class="field">
          <p class="control has-icons-left">
            <input
              v-model="password"
              class="input"
              name="password"
              type="password"
              autocomplete="current-password"
              placeholder="Password"
              required
            />
            <span class="icon is-small is-left"><i class="fas fa-lock"></i></span>
          </p>
          <p v-if="error" class="help is-danger" data-testid="reauth-error">{{ error }}</p>
        </div>
        <Turnstile v-if="isProduction" ref="captcha" v-model="captchaToken" :site-key="siteKey" />
      </div>
      <footer class="card-footer">
        <button
          type="button"
          class="card-footer-item is-white button"
          data-testid="reauth-later"
          @click="authStore.dismissReauth()"
        >
          {{ $t("later") }}
        </button>
        <button
          type="submit"
          class="card-footer-item is-white button has-text-primary"
          :class="{ 'is-loading': loading }"
          :disabled="!password || (isProduction && !!siteKey && !captchaToken)"
          data-testid="reauth-submit"
        >
          {{ $t("log_in_again") }}
        </button>
      </footer>
    </form>
  </template>
</template>

<style scoped lang="scss">
.reauth-prompt,
.reauth-reopen {
  // Top centre: clear of the toolbox (left), the chat and the top-bar
  // controls (right).
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  // Above everything on the stage, the preloader curtain (20000) included.
  z-index: 20002;
}
.reauth-reopen {
  top: 8px;
}
.reauth-prompt {
  top: 56px;
  width: min(340px, calc(100vw - 32px));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  // The stage disables text selection; the form must stay usable.
  user-select: text;
}
</style>
