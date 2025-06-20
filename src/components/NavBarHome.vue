<template>
  <nav class="navbar" role="navigation" aria-label="main navigation">
    <div class="navbar-brand">
      <Logo link="https://www.upstage.org.nz" target="_blank" />
      <LanguageSelector class="is-hidden-desktop" />
      <a role="button" class="navbar-burger" aria-label="menu" aria-expanded="false" @click="toggleExpanded">
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
        <span aria-hidden="true"></span>
      </a>
    </div>
    <LanguageSelector class="is-hidden-mobile is-hidden-tablet-only" />

    <div :class="{ 'navbar-menu': true, 'is-active': expanded }">
      <div class="navbar-start">
        <div v-if="!navigations" class="navbar-item" style="text-transform: none">
          Cannot display navigation properly, please check your menu syntax in
          Admin section!
        </div>
        <template v-else>
          <template v-for="(menu, i) in navigations" :key="i">
            <div v-if="menu.children" class="navbar-item has-dropdown is-hoverable">
              <a v-if="menu.url" class="navbar-link is-arrowless" :href="menu.url"
                :target="menu.url?.startsWith('http') ? '_blank' : ''">
                {{ menu.title }}
              </a>
              <a v-else class="navbar-link is-arrowless">{{ menu.title }}</a>
              <div class="navbar-dropdown">
                <a v-for="(submenu, j) in menu.children" :key="j" class="navbar-item" :href="submenu.url"
                  :target="submenu.url?.startsWith('http') ? '_blank' : ''">
                  {{ submenu.title }}
                </a>
              </div>
            </div>
            <a v-else-if="isShow(menu.seeByAdmin)" class="navbar-item" :href="menu.url"
              :target="menu.url?.startsWith('http') ? '_blank' : ''">
              {{ menu.title }}
            </a>
            <div v-if="isAdmin && i < navigations.length - 1" class="vertical-divider" />
          </template>
        </template>
      </div>

      <div class="navbar-end">
        <template v-if="loggedIn">
          <RouterLink v-if="!isGuest" to="/stages" class="button is-primary m-2">
            <strong>{{ $t("studio") }}</strong>
          </RouterLink>
          <button @click="handleLogout" class="button m-2 mr-6">
            <strong>{{ $t("logout") }}</strong>
          </button>
        </template>
        <template v-else>
          <router-link to="/login" class="button is-primary m-2">
            <strong>{{ $t("login") }}</strong>
          </router-link>
          <router-link v-if="showRegistration" to="/register" class="button is-primary m-2 mr-6">
            <strong>{{ $t("register") }}</strong>
          </router-link>
        </template>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref, type Ref } from "vue";
import { useConfigStore } from "store/modules/config";
import { useUserStore } from "store/modules/user";
import { useAuthStore } from "store/modules/auth";
import { storeToRefs } from "pinia";
import Logo from "./Logo.vue";
import LanguageSelector from "./LanguageSelector.vue";
import configs from "config";

interface SubMenu {
  title: string;
  url: string;
}

interface Menu {
  title: string;
  url?: string;
  seeByAdmin: boolean;
  children?: SubMenu[];
}

// Store initialization
const configStore = useConfigStore();
const userStore = useUserStore();
const authStore = useAuthStore();

// Refs
const expanded = ref(false);

// Computed properties
const { navigations } = storeToRefs(configStore) as { navigations: Ref<Menu[]> };
const { isAdmin, isGuest } = storeToRefs(userStore);
const loggedIn = computed(() => userStore.whoami !== null);
const showRegistration = computed(() => configStore.foyer?.showRegistration?.value ?? false);

// Methods
const toggleExpanded = () => (expanded.value = !expanded.value);

const isShow = (seeByAdmin: boolean) => {
  if (isAdmin.value) {
    return true;
  }
  return !seeByAdmin;
};

const handleLogout = () => {
  authStore.logout();
};
</script>

<style lang="scss">
@media screen and (max-width: 1023px) {
  .navbar-menu {
    position: absolute;
    width: 100%;
  }

  .navbar-end a {
    margin-left: auto;
  }
}
</style>
