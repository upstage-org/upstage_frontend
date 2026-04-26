import { defineStore } from "pinia";
import { ref } from "vue";

export const useStageReplayStore = defineStore("stage-replay", () => {
  const isReplaying = ref<boolean>(false);
  const cursor = ref<number>(0);
  const playbackRate = ref<number>(1);

  const start = () => {
    isReplaying.value = true;
  };
  const stop = () => {
    isReplaying.value = false;
    cursor.value = 0;
  };

  return { isReplaying, cursor, playbackRate, start, stop };
});
