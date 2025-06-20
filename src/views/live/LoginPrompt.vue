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
            <InputButtonPostfix v-model="nickname" placeholder="Guest" icon="fas fa-sign-in-alt"
              title="Choose a nickname" @ok="enterAsAudience" />
          </div>
        </div>
      </div>
    </div>
    <button v-if="showLoginForm" class="button is-light is-outlined mt-4" @click="showLoginForm = false">
      <span class="icon">
        <i class="fas fa-chevron-left"></i>
      </span>
      <span>{{ $t("enter_as_audience") }}</span>
    </button>
    <button v-else class="button is-light is-outlined mt-4" @click="showLoginForm = true">
      <span>{{ $t("player_login") }}</span>
      <span class="icon">
        <i class="fas fa-chevron-right"></i>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { message } from "ant-design-vue";
import { animate } from "animejs";
import LoginForm from "components/LoginForm.vue";
import InputButtonPostfix from "components/form/InputButtonPostfix.vue";
import { useAuthStore } from "../../store/auth";
import { useUserStore } from "../../store/user";
import { useStageStore } from "../../store/stage";

const authStore = useAuthStore();
const userStore = useUserStore();
const stageStore = useStageStore();

const showing = ref(!authStore.loggedIn);
const showLoginForm = ref(false);
const nickname = ref();
const modal = ref();

onMounted(() => {
  animate(modal.value, {
    rotate: ["-3deg", "3deg", "0deg"],
    duration: 100,
    direction: "alternate",
    loop: 5,
    ease: "outBack",
  });
});

watch(() => authStore.loggedIn, (newValue) => {
  if (newValue) {
    userStore.fetchCurrent().then(() => stageStore.joinStage());
    close();
  }
});

const close = () => (showing.value = false);

const enterAsAudience = async () => {
  if (!showLoginForm.value) {
    try {
      const savedNickname = await userStore.saveNickname(nickname.value);
      message.success(
        "Welcome to the stage! Your nickname is " + savedNickname + "!"
      );
      close();
    } catch (error) {
      message.error("Failed to enter as audience");
    }
  }
};

const onLoginSuccess = () => {
  stageStore?.reloadPermission();
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
