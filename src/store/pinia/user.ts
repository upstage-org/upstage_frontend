import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { displayName } from "@utils/auth";
import { ROLES } from "@utils/constants";

interface UserData {
  id?: string | number;
  role?: string | number;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
}

/**
 * User profile store. Note we deliberately avoid reaching into other modules'
 * state from here (the old Vuex `user/avatar` getter pulled
 * `rootState.stage.board.objects`, creating a cross-module coupling). Avatar
 * lookups now live in the stage stores; consumers compose them explicitly.
 */
export const useUserStore = defineStore("user", () => {
  const user = ref<UserData | null>(null);
  const loadingUser = ref<boolean>(false);
  const nickname = ref<string | null>(null);
  const avatarId = ref<string | number | null>(null);

  const whoami = computed<UserData | null>(() => user.value);
  const displayedNickname = computed<string>(
    () => nickname.value ?? (user.value ? displayName(user.value) : "Guest"),
  );
  const isAdmin = computed<boolean>(() =>
    [String(ROLES.ADMIN), String(ROLES.SUPER_ADMIN)].includes(
      String(user.value?.role),
    ),
  );
  const isGuest = computed<boolean>(() => {
    if (!user.value) return true;
    return String(user.value.role) === String(ROLES.GUEST);
  });
  const currentUserId = computed(() => user.value?.id);

  return {
    user,
    loadingUser,
    nickname,
    avatarId,
    whoami,
    displayedNickname,
    isAdmin,
    isGuest,
    currentUserId,
  };
});
