<script setup lang="ts">
import { inject, onMounted, ref, watch } from "vue";
import { animate } from "animejs";
import { message } from "ant-design-vue";
import LoginForm from "components/LoginForm.vue";
import InputButtonPostfix from "components/form/InputButtonPostfix.vue";
import { useAuthStore } from "@stores/pinia/auth";
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import { storeToRefs } from "pinia";

const stageStore = useStageStore();
const userStore = useUserStore();
/** When true (standalone `/chat/:url`), skip portrait `zoom` — it blows up mobile layout. */
const isChatStandalone = inject<boolean>("isChatStandalone", false);
const { loggedIn } = storeToRefs(useAuthStore());
const showing = ref<boolean>(!loggedIn.value);
const showLoginForm = ref<boolean>(false);
const nickname = ref<string>();
const modal = ref<HTMLElement>();

onMounted(() => {
  if (modal.value) {
    animate(modal.value, {
      rotate: ["-3deg", "3deg", "0deg"],
      duration: 100,
      direction: "alternate",
      loop: 5,
      ease: "outBack",
    });
  }
});

const close = () => (showing.value = false);

watch(loggedIn, () => {
  if (loggedIn.value) {
    userStore.fetchCurrent().then(() => stageStore.joinStage());
    close();
  }
});

const enterAsAudience = () => {
  if (!showLoginForm.value) {
    userStore
      .saveNickname({ nickname: nickname.value ?? "Guest" })
      .then((resolved: string = "Guest") => {
        message.success("Welcome to the stage! Your nickname is " + resolved + "!");
        close();
      });
  }
};

const onLoginSuccess = () => {
  stageStore.reloadPermission();
};
</script>

<template>
  <div
    class="modal"
    :class="{ 'is-active': showing, 'login-prompt--chat-standalone': isChatStandalone }"
  >
    <div class="modal-background" @click="enterAsAudience"></div>
    <div ref="modal" class="modal-content">
      <LoginForm v-if="showLoginForm" @success="onLoginSuccess" />
      <div v-else class="card">
        <header class="card-header">
          <p class="card-header-title">
            {{ $t("click_anywhere_to_enter_the_stage") }}
          </p>
        </header>
        <div class="card-content">
          <div class="content">
            <label class="label" style="font-weight: normal">
              Choose a nickname if you want one:
            </label>
            <InputButtonPostfix
              v-model="nickname"
              placeholder="Guest"
              icon="fas fa-sign-in-alt"
              title="Choose a nickname"
              @ok="enterAsAudience"
            />
          </div>
        </div>
      </div>
    </div>
    <button
      v-if="showLoginForm"
      class="button is-light is-outlined mt-4"
      @click="showLoginForm = false"
    >
      <span class="icon"><i class="fas fa-chevron-left"></i></span>
      <span>{{ $t("enter_as_audience") }}</span>
    </button>
    <button v-else class="button is-light is-outlined mt-4" @click="showLoginForm = true">
      <span>{{ $t("player_login") }}</span>
      <span class="icon"><i class="fas fa-chevron-right"></i></span>
    </button>
  </div>
</template>

<style scoped lang="scss">
.modal-close {
  position: relative;
}
.modal-content {
  max-width: 500px;
}
@media only screen and (orientation: portrait) {
  /* Live stage only: enlarge the overlay so tap targets are usable on a tiny stage frame. */
  .modal:not(.login-prompt--chat-standalone) {
    zoom: 3;
  }
  .modal:not(.login-prompt--chat-standalone) .modal-content {
    max-width: unset;
    width: 100%;
  }
}

/* `/chat/:url` — fill the viewport width without CSS zoom (readable on phones & tablets). */
.login-prompt--chat-standalone.modal {
  align-items: flex-start;
  padding: 12px;
  box-sizing: border-box;
}
.login-prompt--chat-standalone .modal-content {
  width: 100%;
  max-width: min(500px, calc(100vw - 24px));
  margin: 0 auto;
  box-sizing: border-box;
}
.login-prompt--chat-standalone > .button {
  align-self: center;
  width: 100%;
  max-width: min(500px, calc(100vw - 24px));
  box-sizing: border-box;
}
</style>
