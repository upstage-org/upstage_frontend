import { defineStore } from 'pinia';
import { router } from '../../router';
import { userGraph } from 'services/graphql';
import { displayName, logout as doLogout } from 'utils/auth';
import { ROLES } from 'constants';
import { message } from 'ant-design-vue';
import { useAuthStore } from './auth';

interface UserState {
  user: any;
  loadingUser: boolean;
  nickname: string | null;
  avatarId: string | null;
}

export const useUserStore = defineStore('user', {
  state: (): UserState => ({
    user: null,
    loadingUser: false,
    nickname: null,
    avatarId: null,
  }),
  getters: {
    whoami: (state) => state.user,
    nickname: (state) => state.nickname ?? (state.user ? displayName(state.user) : 'Guest'),
    chatname: (state) => {
      let name = state.nickname ?? (state.user ? displayName(state.user) : 'Guest');
      // Avatar logic can be added here if needed
      return name;
    },
    isAdmin: (state) => [String(ROLES.ADMIN), String(ROLES.SUPER_ADMIN)].includes(String(state.user?.role)),
    isGuest: (state) => {
      if (!state.user) return true;
      if (String(state.user.role) === String(ROLES.GUEST)) return true;
      return false;
    },
    avatarId: (state) => state.avatarId,
    // avatar and currentUserId depend on rootState or other modules, so you may need to inject or refactor their logic in components
    currentUserId: (state) => state.user?.id,
  },
  actions: {
    async updateUserProfile(payload: any) {
      this.loadingUser = true;
      try {
        const { updateUser } = await userGraph.updateUser(payload);
        this.user = updateUser;
        return updateUser;
      } catch (error) {
        message.warning('Failed update!');
      } finally {
        this.loadingUser = false;
      }
    },
    async fetchCurrent() {
      this.loadingUser = true;
      try {
        const authStore = useAuthStore();
        const token = authStore.getToken;
        if (!token) return;
        const { currentUser } = await userGraph.currentUser();
        this.user = currentUser;
        this.nickname = displayName(currentUser);
        return currentUser;
      } catch (error: any) {
        const errorMsg = error.response?.errors[0]?.message;
        if ([
          'Missing Authorization Header',
          'Signature verification failed',
          'Signature has expired',
          'Authenticated Failed',
        ].some((message) => errorMsg?.includes(message))) {
          doLogout();
          if (router.currentRoute.value.meta.requireAuth) {
            router.push('/login');
            message.warning('You have been logged out of this session!');
          }
        }
      } finally {
        this.loadingUser = false;
      }
    },
    async saveNickname({ nickname }: { nickname: string }) {
      // Avatar logic can be added here if needed
      this.nickname = nickname;
      // If you need to interact with stage/joinStage, do it in the component or via another Pinia store
      return nickname;
    },
    setAvatarId(id: string) {
      this.avatarId = id;
      // If you need to interact with stage/joinStage, do it in the component or via another Pinia store
    },
    async checkIsAdmin() {
      this.loadingUser = true;
      try {
        const { currentUser } = await userGraph.currentUser();
        return [String(ROLES.ADMIN), String(ROLES.SUPER_ADMIN)].includes(String(currentUser?.role));
      } catch (error: any) {
        if ([
          'Missing Authorization Header',
          'Signature verification failed',
          'Signature has expired',
          'Authenticated Failed',
        ].some((message) => error.message?.includes(message))) {
          doLogout();
          if (router.currentRoute.value.meta.requireAuth) {
            router.push('/login');
            message.warning('You have been logged out of this session!');
          }
        }
      } finally {
        this.loadingUser = false;
      }
    },
    async checkIsGuest() {
      this.loadingUser = true;
      try {
        const { currentUser } = await userGraph.currentUser();
        if (!currentUser) return true;
        if (String(currentUser.role) === String(ROLES.GUEST)) return true;
        return false;
      } catch (error: any) {
        if ([
          'Missing Authorization Header',
          'Signature verification failed',
          'Signature has expired',
          'Authenticated Failed',
        ].some((message) => error.message?.includes(message))) {
          doLogout();
          if (router.currentRoute.value.meta.requireAuth) {
            router.push('/login');
            message.warning('You have been logged out of this session!');
          }
        }
      } finally {
        this.loadingUser = false;
      }
    },
  },
});
