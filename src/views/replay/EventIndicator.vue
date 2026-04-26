<template>
  <div class="event-indicator">
    <div
      v-for="event in events"
      :key="event.id"
      :style="{ left: position(event) + '%' }"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";

interface ReplayEvent {
  id: string | number;
  mqttTimestamp: string | number;
}

const store = useStore();
const events = computed<ReplayEvent[]>(() => store.state.stage.model.events);
const begin = computed<number>(() => Number(store.state.stage.replay.timestamp.begin));
const end = computed<number>(() => Number(store.state.stage.replay.timestamp.end));
const duration = computed<number>(() => end.value - begin.value);

const position = (event: ReplayEvent): number =>
  ((Number(event.mqttTimestamp) - begin.value) * 100) / duration.value;
</script>

<style scoped lang="scss">
.event-indicator {
  pointer-events: none;
  position: relative;
  width: 100%;
  height: 8px;
  top: -24px;
  > div {
    position: absolute;
    height: 100%;
    width: 1px;
    background-color: #007011;
  }
}
</style>
