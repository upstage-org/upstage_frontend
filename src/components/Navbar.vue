<script lang="ts" setup>
import Notifications from "components/Notifications.vue";
import LanguageSelector from "components/LanguageSelector.vue";
import logo from "assets/upstage.png";
import StudioVersion from "./StudioVersion.vue";
import PlayerForm from "views/admin/player-management/PlayerForm.vue";
import { computed } from "vue";
import { logoutToHome } from "utils/auth";
import { useUserStore } from "@stores/pinia/user";
import { storeToRefs } from "pinia";

const userStore = useUserStore();
const { whoami, loadingUser: loading } = storeToRefs(userStore);
const roleName = computed(() => {
  switch (whoami.value?.role) {
    case "4":
      return "Guest";
    case "1":
      return "Player";
    case "8":
      return "Admin";
    case "32":
      return "SuperAdmin";
  }
  return "";
});
const onSave = (payload: any) => {
  userStore.updateUserProfile(payload);
};
</script>

<template>
  <a-space>
    <PlayerForm
      v-if="whoami"
      v-slot="{ onClick }"
      :player="whoami"
      :on-save="onSave"
      :saving="loading"
      no-upload-limit
      no-status-toggle
    >
      <div :onClick="onClick" class="cursor-pointer">
        <span class="text-gray-500 cursor-pointer">{{ roleName }}</span>
        <a-typography-title :level="5" style="margin-bottom: 0">
          <span class="whitespace-nowrap">
            {{ whoami.displayName || whoami.username }}
          </span>
        </a-typography-title>
      </div>
    </PlayerForm>
    <Notifications />
    <a-space direction="vertical">
      <LanguageSelector />
      <StudioVersion />
    </a-space>
    <a-dropdown class="ml-4">
      <a class="ant-dropdown-link flex-nowrap block w-24" @click.prevent>
        <img :src="logo" class="h-6" />
        <down-outlined />
      </a>
      <template #overlay>
        <a-menu>
          <RouterLink to="/">
            <a-menu-item>{{ $t("foyer") }}</a-menu-item>
          </RouterLink>
          <a-menu-item @click="logoutToHome">{{ $t("logout") }}</a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
  </a-space>
</template>
