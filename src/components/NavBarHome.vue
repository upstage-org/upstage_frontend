<script>
import { computed } from "vue";
import { loggedIn, logoutToHome } from "utils/auth";
import { useUserStore } from "@stores/pinia/user";
import { useConfigStore } from "@stores/pinia/config";
import { storeToRefs } from "pinia";
import Logo from "./Logo.vue";
import LanguageSelector from "./LanguageSelector.vue";
import configs from "config";

export default {
  components: { Logo, LanguageSelector },
  setup() {
    const { navigations, foyer } = storeToRefs(useConfigStore());
    const { isAdmin, isGuest } = storeToRefs(useUserStore());
    const showRegistration = computed(() => foyer.value?.showRegistration?.value ?? false);

    const isShow = (seeByAdmin) => {
      if (isAdmin.value) {
        return true;
      }

      return !seeByAdmin;
    };

    return {
      loggedIn,
      logoutToHome,
      showRegistration,
      isShow,
      navigations,
      isAdmin,
      isGuest,
    };
  },
  computed: {
    configs() {
      return configs;
    },
  },
};
</script>

<template>
  <nav class="navbar" role="navigation" aria-label="main navigation">
    <div class="navbar-brand">
      <Logo link="https://www.upstage.org.nz" target="_blank" />
    </div>
    <LanguageSelector />

    <div class="navbar-menu always-flex">
      <div class="navbar-start">
        <div v-if="!navigations" class="navbar-item" style="text-transform: none">
          Cannot display navigation properly, please check your menu syntax in Admin section!
        </div>
        <template v-else>
          <template v-for="(menu, i) in navigations" :key="i">
            <div v-if="menu.children" class="navbar-item has-dropdown is-hoverable">
              <a
                v-if="menu.url"
                class="navbar-link is-arrowless"
                :href="menu.url"
                :target="menu.url?.startsWith('http') ? '_blank' : ''"
              >
                {{ menu.title }}
              </a>
              <a v-else class="navbar-link is-arrowless">{{ menu.title }}</a>
              <div class="navbar-dropdown">
                <a
                  v-for="(submenu, j) in menu.children"
                  :key="{ j }"
                  class="navbar-item"
                  :href="submenu.url"
                  :target="submenu.url?.startsWith('http') ? '_blank' : ''"
                >
                  {{ submenu.title }}
                </a>
              </div>
            </div>
            <a
              v-else-if="isShow(menu.seeByAdmin)"
              class="navbar-item"
              :href="menu.url"
              :target="menu.url?.startsWith('http') ? '_blank' : ''"
            >
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
          <button class="button m-2 mr-6" @click="logoutToHome">
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

<style lang="scss">
.navbar {
  flex-wrap: wrap;
}

.navbar-menu.always-flex {
  display: flex !important;
  flex-grow: 1;
  align-items: center;
  flex-wrap: wrap;
  background: transparent;
  box-shadow: none;
  padding: 0;
}

.navbar-menu.always-flex .navbar-start,
.navbar-menu.always-flex .navbar-end {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}
</style>
