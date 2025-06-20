<script setup lang="ts">
import { useMutation } from "@vue/apollo-composable";
import configs from "config";
import gql from "graphql-tag";
import { Auth } from "models/config";
import { useAuthStore } from "store/modules/auth";
import { ref } from "vue";

const authStore = useAuthStore();
const isDev = import.meta.env.DEV;

const { mutate, loading } = useMutation<
  { authUser: { accessToken: string; refreshToken: string } },
  Auth
>(gql`
  mutation Login($username: String, $password: String) {
    authUser(username: $username, password: $password) {
      accessToken
      refreshToken
    }
  }
`);

const handleQuickLogin = async () => {
  const username = prompt("Username:", "nguyenhongphat0")?.trim();
  if (username) {
    const password = prompt("Password:");
    if (password) {
      const res = await mutate({
        username,
        password,
      });
      if (res && res.data) {
        await authStore.login({
          username,
          password,
        });
      }
    }
  }
};
</script>

<template>
  <!-- <suspense v-if="auth && (auth.token || auth.refresh_token)"> -->
  <suspense>
    <template #fallback>
      <a-spin />
    </template>
    <slot></slot>
  </suspense>
  <!-- <a-result
    v-else
    status="403"
    title="UpStage Player Required"
    sub-title="Sorry, you are not authorized to access this page."
  >
    <template #extra>
      <a :href="`${configs.UPSTAGE_URL}/backstage`">
        <a-button type="primary">{{ $t("login") }}</a-button>
      </a>
      <a-tooltip title="Quick login for developers">
        <a-button v-if="isDev" @click="handleQuickLogin" :loading="loading"
          >🔑</a-button
        >
      </a-tooltip>
    </template>
  </a-result> -->
</template>
