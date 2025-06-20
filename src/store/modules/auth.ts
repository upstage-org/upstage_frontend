// @ts-nocheck
import { defineStore } from 'pinia';
import { userGraph } from "services/graphql";

import {
  setToken,
  removeToken,
  setRefreshToken,
  removeRefreshToken,
} from "utils/auth";
import { message } from "ant-design-vue";

interface AuthState {
  username: string;
  token: string;
  refresh_token: string;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    username: "",
    token: "",
    refresh_token: "",
  }),

  getters: {
    loggedIn: (state) => !!state.token,
    getToken: (state) => state.token,
    getRefreshToken: (state) => state.refresh_token,
  },

  actions: {
    setUsername(username: string) {
      this.username = username;
    },

    setToken(token: string) {
      this.token = token;
    },

    setRefreshToken(refreshToken: string) {
      this.refresh_token = refreshToken;
    },

    clearUserData() {
      this.token = "";
      this.refresh_token = "";
    },

    async login(user: any) {
      try {
        const resp = await userGraph.login(user);
            if (resp?.login?.access_token) {
              const { access_token, refresh_token, username } = resp.login;
              setToken(access_token);
              setRefreshToken(refresh_token);
          this.setUsername(username);
          this.setToken(access_token);
          this.setRefreshToken(refresh_token);
          return;
        }
        message.error(resp?.errors[0]?.message);
        throw resp;
      } catch (err: any) {
            message.error(
              err.response?.errors ? err.response?.errors[0].message : "Error!"
            );
        throw err;
      }
    },

    logout() {
      this.clearUserData();
      localStorage.clear();
      removeToken();
      removeRefreshToken();
      window.location.href = "/";
    },

    async fetchRefreshToken() {
      try {
        const response = await userGraph.refreshUser(
          {
            refreshToken: this.refresh_token,
          },
          {
            "X-Access-Token": this.refresh_token,
          }
        );
          const token = response.refreshToken.access_token;
        this.setToken(token);
          return token;
      } catch (err) {
        this.clearUserData();
          localStorage.clear();
          removeToken();
          removeRefreshToken();
          window.location.href = "/";
        throw err;
      }
    },
  },
});
