<template>
  <div class="modal" :class="{ 'is-active': showing }">
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
    <button
      v-else
      class="button is-light is-outlined mt-4"
      @click="showLoginForm = true"
    >
      <span>{{ $t("player_login") }}</span>
      <span class="icon"><i class="fas fa-chevron-right"></i></span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { animate } from "animejs";
import { message } from "ant-design-vue";
import LoginForm from "components/LoginForm.vue";
import InputButtonPostfix from "components/form/InputButtonPostfix.vue";

const store = useStore();
const loggedIn = computed<boolean>(() => store.getters["auth/loggedIn"]);
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
    store.dispatch("user/fetchCurrent").then(() => store.dispatch("stage/joinStage"));
    close();
  }
});

const enterAsAudience = () => {
  if (!showLoginForm.value) {
    store
      .dispatch("user/saveNickname", { nickname: nickname.value })
      .then((resolved: string = "Guest") => {
        message.success("Welcome to the stage! Your nickname is " + resolved + "!");
        close();
      });
  }
};

const onLoginSuccess = () => {
  store.dispatch("stage/reloadPermission");
};
</script>

<style scoped lang="scss">
.modal-close {
  position: relative;
}
.modal-content {
  max-width: 500px;
}
@media only screen and (orientation: portrait) {
  .modal {
    zoom: 3;
  }
  .modal-content {
    max-width: unset;
    width: 100%;
  }
}
</style>
