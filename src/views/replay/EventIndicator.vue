<script setup lang="ts">
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";

interface ReplayEvent {
  id: string | number;
  mqttTimestamp: string | number;
}

interface StageModelShape {
  events?: ReplayEvent[];
}

const stageStore = useStageStore();
// `stageStore.model` is inferred as `null` by TS because the Pinia
// stage store declares `model = ref(null)` (the store file itself has
// `// @ts-nocheck`, so the wider model shape never escaped it). A
// local cast is the smallest fix; tightening the store's exported
// types is tracked as a follow-up.
const model = computed(() => stageStore.model as unknown as StageModelShape | null);
const events = computed<ReplayEvent[]>(() => model.value?.events ?? []);
const begin = computed<number>(() => Number(stageStore.replay.timestamp.begin));
const end = computed<number>(() => Number(stageStore.replay.timestamp.end));
const duration = computed<number>(() => end.value - begin.value);

const position = (event: ReplayEvent): number =>
  ((Number(event.mqttTimestamp) - begin.value) * 100) / duration.value;
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
