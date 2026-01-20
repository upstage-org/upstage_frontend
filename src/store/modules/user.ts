// @ts-nocheck
import { userGraph } from "services/graphql";
import { displayName, logout } from "utils/auth";
import { ROLES } from "utils/constants";
import { message } from "ant-design-vue";
import store from "store/index";

// Lazy router import to avoid circular dependency
let routerInstance: any = null;
const getRouter = async () => {
  if (!routerInstance) {
    const routerModule = await import("../../router");
    routerInstance = routerModule.router;
  }
  return routerInstance;
};

export default {
  namespaced: true,
  state: {
    user: null,
    loadingUser: false,
    nickname: null,
    avatarId: null,
  },
  mutations: {
    SET_USER_DATA(state, data) {
      state.user = data;
    },
    SET_LOADING_USER(state, loading) {
      state.loadingUser = loading;
    },
    SET_NICK_NAME(state, nickname) {
      state.nickname = nickname;
    },
    SET_AVATAR_ID(state, id) {
      state.avatarId = id;
    },
  },
  actions: {
    async updateUserProfile({ commit }, payload) {
      commit("SET_LOADING_USER", true);
      try {
        const { updateUser } = await userGraph.updateUser(payload);
        commit("SET_USER_DATA", updateUser);
        return updateUser;
      } catch (error) {
        message.warning("Failed update!");
      } finally {
        commit("SET_LOADING_USER", false);
      }
    },
    async fetchCurrent({ commit }) {
      commit("SET_LOADING_USER", true);
      try {
        const token = store.getters["auth/getToken"];
        if (!token) return;
        const { currentUser } = await userGraph.currentUser();
        commit("SET_USER_DATA", currentUser);
        commit("SET_NICK_NAME", displayName(currentUser));
        return currentUser;
      } catch (error) {
        const errorMsg = error.response?.errors[0]?.message;
        if (
          [
            "Missing Authorization Header",
            "Signature verification failed",
            "Signature has expired",
            "Authenticated Failed",
          ].some((message) => errorMsg?.includes(message))
        ) {
          logout();

          const router = await getRouter();
          if (router.currentRoute.value.meta.requireAuth) {
            router.push("/login");
            message.warning("You have been logged out of this session!");
          }
        }
      } finally {
        commit("SET_LOADING_USER", false);
      }
    },
    async saveNickname({ commit, dispatch, getters }, { nickname }) {
      const avatar = getters.avatar;
      if (avatar) {
        dispatch(
          "stage/shapeObject",
          {
            ...avatar,
            name: nickname,
          },
          { root: true }
        );
      } else {
        commit("SET_NICK_NAME", nickname);
        dispatch("stage/joinStage", null, { root: true });
      }
      return nickname;
    },
    setAvatarId({ commit, dispatch }, id) {
      commit("SET_AVATAR_ID", id);
      dispatch("stage/joinStage", null, { root: true });
    },
    async checkIsAdmin({ commit }) {
      commit("SET_LOADING_USER", true);
      try {
        const { currentUser } = await userGraph.currentUser();
        return [String(ROLES.ADMIN), String(ROLES.SUPER_ADMIN)].includes(
          String(currentUser?.role)
        );
      } catch (error) {
        if (
          [
            "Missing Authorization Header",
            "Signature verification failed",
            "Signature has expired",
            "Authenticated Failed",
          ].some((message) => error.message?.includes(message))
        ) {
          logout();

          const router = await getRouter();
          if (router.currentRoute.value.meta.requireAuth) {
            router.push("/login");
            message.warning("You have been logged out of this session!");
          }
        }
      } finally {
        commit("SET_LOADING_USER", false);
      }
    },
    async checkIsGuest({ commit }) {
      commit("SET_LOADING_USER", true);
      try {
        const { currentUser } = await userGraph.currentUser();
        if (!currentUser) {
          return true;
        }
        if (String(currentUser.role) === String(ROLES.GUEST)) {
          return true;
        }
        return false;
      } catch (error) {
        if (
          [
            "Missing Authorization Header",
            "Signature verification failed",
            "Signature has expired",
            "Authenticated Failed",
          ].some((message) => error.message?.includes(message))
        ) {
          logout();

          const router = await getRouter();
          if (router.currentRoute.value.meta.requireAuth) {
            router.push("/login");
            message.warning("You have been logged out of this session!");
          }
        }
      } finally {
        commit("SET_LOADING_USER", false);
      }
    },
  },
  getters: {
    whoami(state) {
      return state.user;
    },
    nickname(state) {
      return state.nickname ?? (state.user ? displayName(state.user) : "Guest");
    },
    chatname(state, getters) {
      let name = getters.nickname;
      const avatar = getters.avatar;
      if (avatar && avatar.name) {
        name = avatar.name;
      }
      return name;
    },
    isAdmin(state) {
      return [String(ROLES.ADMIN), String(ROLES.SUPER_ADMIN)].includes(
        String(state.user?.role)
      );
    },
    isGuest(state) {
      if (!state.user) {
        return true;
      }
      if (String(state.user.role) === String(ROLES.GUEST)) {
        return true;
      }
      return false;
    },
    avatarId(state) {
      return state.avatarId;
    },
    avatar(state, getters, rootState) {
      if (state.avatarId) {
        const avatar = rootState.stage.board.objects.find(
          (o) => o.id === state.avatarId
        );
        return avatar;
      }
    },
    currentUserId(state) {
      return state.user.id;
    },
  },
};
