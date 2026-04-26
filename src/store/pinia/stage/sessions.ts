import { defineStore } from "pinia";
import { ref } from "vue";

interface SessionUser {
  id: string | number;
  username?: string;
  nickname?: string;
}

export const useStageSessionsStore = defineStore("stage-sessions", () => {
  const audience = ref<SessionUser[]>([]);
  const players = ref<SessionUser[]>([]);

  const setAudience = (users: SessionUser[]) => {
    audience.value = users;
  };
  const setPlayers = (users: SessionUser[]) => {
    players.value = users;
  };

  return { audience, players, setAudience, setPlayers };
});
