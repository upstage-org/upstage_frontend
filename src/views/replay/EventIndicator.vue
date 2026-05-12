<script setup lang="ts">
import { computed } from "vue";
import { useStageStore, type ReplayEvent } from "@stores/pinia/stage";

const stageStore = useStageStore();
const events = computed<ReplayEvent[]>(() => stageStore.model?.events ?? []);
const begin = computed<number>(() => stageStore.replay.timestamp.begin);
const end = computed<number>(() => stageStore.replay.timestamp.end);
const duration = computed<number>(() => end.value - begin.value);

const position = (event: ReplayEvent): number =>
  ((event.mqttTimestamp - begin.value) * 100) / duration.value;
</script>

<template>
  <div class="event-indicator">
    <div v-for="event in events" :key="event.id" :style="{ left: position(event) + '%' }"></div>
  </div>
</template>

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
