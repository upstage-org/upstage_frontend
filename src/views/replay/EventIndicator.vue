<template>
  <div class="event-indicator">
    <div v-for="event in events" :key="event.id" :style="{ left: position(event) + '%' }"></div>
  </div>
</template>

<script>
import { computed } from "vue";
import { useStageStore } from "store/modules/stage";
import { storeToRefs } from "pinia";

const stageStore = useStageStore();
const { model, replay } = storeToRefs(stageStore);

const events = computed(() => model.value?.events);
const begin = computed(() => Number(replay.value.timestamp.begin));
const end = computed(() => Number(replay.value.timestamp.end));
const duration = computed(() => end.value - begin.value);

const position = (event) => {
  return (
    ((Number(event.mqttTimestamp) - begin.value) * 100) / duration.value
  );
};

export default {
  setup() {
    return {
      events,
      position,
    };
  },
};
</script>

<style scoped lang="scss">
.event-indicator {
  pointer-events: none;
  position: relative;
  width: 100%;
  height: 8px;
  top: -24px;

  >div {
    position: absolute;
    height: 100%;
    width: 1px;
    background-color: #007011;
  }
}
</style>
