<script setup lang="ts">
import Notifications from "components/Notifications.vue";
import LanguageSelector from "components/LanguageSelector.vue";
import configs from "config";
import logo from "assets/upstage.png";
import StudioVersion from "./StudioVersion.vue";
import PlayerForm from "views/admin/player-management/PlayerForm.vue";
import { useUserStore } from "store/modules/user";
import { useAuthStore } from "store/modules/auth";
import { userGraph } from "services/graphql";
import { computed } from "vue";
import { ROLES, ROLES_LABELS } from "constants/user";

const userStore = useUserStore();
const authStore = useAuthStore();
const whoami = computed(() => userStore.whoami);
const loading = computed(() => userStore.loadingUser);

const roleName = computed(() => {
  switch (whoami.value?.role) {
    case ROLES.GUEST: return ROLES_LABELS.GUEST;
    case ROLES.PLAYER: return ROLES_LABELS.PLAYER;
    case ROLES.ADMIN: return ROLES_LABELS.ADMIN;
    case ROLES.SUPER_ADMIN: return ROLES_LABELS.SUPER_ADMIN;
    default: return "";
  }
});

const to = (path: string) => `${configs.UPSTAGE_URL}/${path}`;

const onSave = async (payload: any) => {
  await userStore.updateUserProfile(payload);
};

const handleLogout = () => {
  authStore.logout();
};
</script>

<template>
  <a-space>
    <PlayerForm v-if="whoami" :player="whoami" :onSave="onSave" :saving="loading" noUploadLimit noStatusToggle
      v-slot="{ onClick }">
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
          <a-menu-item @click="handleLogout">{{ $t("logout") }}</a-menu-item>
        </a-menu>
      </template>
    </a-dropdown>
  </a-space>
</template>
