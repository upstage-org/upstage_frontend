import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { message } from "ant-design-vue";
import { displayName, logout as logoutHelper } from "@utils/auth";
import { ROLES } from "@utils/constants";
import { userGraph } from "@services/graphql";
import { useAuthStore } from "@stores/pinia/auth";
import { useStageStore } from "@stores/pinia/stage";

interface UserData {
  id?: string | number;
  role?: string | number;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  name?: string;
}

interface BoardObject {
  id: string | number;
  name?: string;
  [k: string]: unknown;
}

const AUTH_ERRORS = [
  "Missing Authorization Header",
  "Signature verification failed",
  "Signature has expired",
  "Authenticated Failed",
];

/**
 * If a server response contains one of the well-known auth errors, hard
 * logout. Mirrors the Vuex handler exactly; we do NOT import the router
 * here to avoid the `store -> router -> store` cycle the route guards
 * already depend on.
 */
const handleAuthFailure = (errorMsg: string | undefined): void => {
  if (errorMsg && AUTH_ERRORS.some((m) => errorMsg.includes(m))) {
    logoutHelper();
    message.warning("You have been logged out of this session!");
  }
};

/**
 * User profile store + actions. Mirrors the legacy Vuex `user` module
 * API; consumers call `useUserStore()` instead of `store.state.user.X`
 * / `store.dispatch("user/...")`.
 *
 * **Cross-store coupling**: `saveNickname` and `setAvatarId` reach into
 * the stage store, and the `avatar` getter reads `stage.board.objects`.
 * After Phase 5.3 Wave F these go via the Pinia stage store
 * (`useStageStore()`); the lazy in-function call dodges the
 * `user → stage → user` import cycle the route guards already rely on.
 */
export const useUserStore = defineStore("user", () => {
  const user = ref<UserData | null>(null);
  const loadingUser = ref<boolean>(false);
  /**
   * Raw nickname override (set by `saveNickname`). When unset, the
   * resolved `nickname` getter falls back to the user's display name —
   * matching the legacy Vuex `user/nickname` getter contract that
   * consumers across the app rely on.
   */
  const nicknameOverride = ref<string | null>(null);
  const avatarId = ref<string | number | null>(null);

  const whoami = computed<UserData | null>(() => user.value);
  const nickname = computed<string>(
    () => nicknameOverride.value ?? (user.value ? displayName(user.value) : "Guest"),
  );
  const isAdmin = computed<boolean>(() =>
    [String(ROLES.ADMIN), String(ROLES.SUPER_ADMIN)].includes(String(user.value?.role)),
  );
  const isGuest = computed<boolean>(() => {
    if (!user.value) return true;
    return String(user.value.role) === String(ROLES.GUEST);
  });
  const currentUserId = computed(() => user.value?.id);

  /**
   * Currently held avatar object on the live stage, or `undefined` if
   * the user hasn't claimed one. Reads from the Pinia stage store's
   * `board.objects` via a lazy `useStageStore()` call.
   */
  const avatar = computed<BoardObject | undefined>(() => {
    if (!avatarId.value) return undefined;
    const objects = useStageStore().board?.objects as BoardObject[] | undefined;
    return objects?.find((o) => o.id === avatarId.value);
  });

  /**
   * Display name for chat messages. Prefers the held avatar's `name`
   * (so when an actor speaks they appear as their character) and falls
   * back to the user's `nickname` getter.
   */
  const chatname = computed<string>(() => {
    const av = avatar.value;
    if (av?.name) return av.name;
    return nickname.value;
  });

  // -- actions --

  const updateUserProfile = async (payload: unknown): Promise<UserData | undefined> => {
    loadingUser.value = true;
    try {
      const { updateUser } = (await userGraph.updateUser(payload)) as { updateUser: UserData };
      user.value = updateUser;
      return updateUser;
    } catch {
      message.warning("Failed update!");
      return undefined;
    } finally {
      loadingUser.value = false;
    }
  };

  /**
   * Hydrate `user` + `nickname` from the GraphQL `currentUser` query.
   * Short-circuits when there's no auth token (avoids issuing a
   * mutation that would 401). Surfaces auth errors via the shared
   * `handleAuthFailure` helper.
   */
  const fetchCurrent = async (): Promise<UserData | undefined> => {
    loadingUser.value = true;
    try {
      const token = useAuthStore().getToken;
      if (!token) return undefined;
      const { currentUser } = (await userGraph.currentUser()) as { currentUser: UserData };
      user.value = currentUser;
      nicknameOverride.value = displayName(currentUser);
      return currentUser;
    } catch (err: unknown) {
      const e = err as { response?: { errors?: Array<{ message?: string }> } };
      handleAuthFailure(e?.response?.errors?.[0]?.message);
      return undefined;
    } finally {
      loadingUser.value = false;
    }
  };

  /**
   * Set the user's display nickname. If they're already holding an
   * avatar, the avatar's `name` is updated instead (and the avatar
   * change broadcasts via `stage.shapeObject`). Otherwise the local
   * nickname ref is updated and the user (re-)joins the stage.
   */
  const saveNickname = async ({ nickname: name }: { nickname: string }): Promise<string> => {
    const av = avatar.value;
    const stage = useStageStore();
    if (av) {
      void Promise.resolve(stage.shapeObject({ ...av, name }));
    } else {
      nicknameOverride.value = name;
      void Promise.resolve(stage.joinStage());
    }
    return name;
  };

  /**
   * Claim the given board object as the user's avatar and (re-)join
   * the stage so other clients see the new ownership.
   */
  const setAvatarId = (id: string | number | null): void => {
    avatarId.value = id;
    void Promise.resolve(useStageStore().joinStage());
  };

  const checkIsAdmin = async (): Promise<boolean | undefined> => {
    loadingUser.value = true;
    try {
      const { currentUser } = (await userGraph.currentUser()) as { currentUser: UserData };
      return [String(ROLES.ADMIN), String(ROLES.SUPER_ADMIN)].includes(String(currentUser?.role));
    } catch (err: unknown) {
      const e = err as { message?: string };
      handleAuthFailure(e?.message);
      return undefined;
    } finally {
      loadingUser.value = false;
    }
  };

  const checkIsGuest = async (): Promise<boolean | undefined> => {
    loadingUser.value = true;
    try {
      const { currentUser } = (await userGraph.currentUser()) as { currentUser: UserData };
      if (!currentUser) return true;
      if (String(currentUser.role) === String(ROLES.GUEST)) return true;
      return false;
    } catch (err: unknown) {
      const e = err as { message?: string };
      handleAuthFailure(e?.message);
      return undefined;
    } finally {
      loadingUser.value = false;
    }
  };

  return {
    user,
    loadingUser,
    nicknameOverride,
    avatarId,
    whoami,
    nickname,
    isAdmin,
    isGuest,
    currentUserId,
    avatar,
    chatname,
    updateUserProfile,
    fetchCurrent,
    saveNickname,
    setAvatarId,
    checkIsAdmin,
    checkIsGuest,
  };
});
