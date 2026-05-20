<script setup lang="ts">
import { computed } from "vue";
import { useStageStore, type ReplayEvent, type ReplayMarker } from "@stores/pinia/stage";

const props = defineProps<{
  seekable?: boolean;
}>();

const emit = defineEmits<{
  seek: [mqttTimestamp: number];
}>();

const stageStore = useStageStore();
const events = computed<ReplayEvent[]>(() => stageStore.model?.events ?? []);
const markers = computed<ReplayMarker[]>(() => stageStore.replay.markers ?? []);
const begin = computed<number>(() => stageStore.replay.timestamp.begin);
const end = computed<number>(() => stageStore.replay.timestamp.end);
const current = computed<number>(() => stageStore.replay.timestamp.current);
const duration = computed<number>(() => Math.max(1, end.value - begin.value));

const position = (mqttTimestamp: number): number =>
  ((mqttTimestamp - begin.value) * 100) / duration.value;

const onMarkerClick = (marker: ReplayMarker) => {
  if (props.seekable) {
    emit("seek", marker.mqttTimestamp);
  }
};

const playheadLeft = computed(() => position(current.value));
</script>

<template>
  <div class="event-indicator-stack">
    <div class="event-indicator" aria-hidden="true">
      <div
        v-for="event in events"
        :key="'ev-' + event.id"
        class="event-tick"
        :style="{ left: position(event.mqttTimestamp) + '%' }"
      />
      <button
        v-for="marker in markers"
        :key="'mk-' + marker.id"
        type="button"
        class="marker-pin"
        :style="{ left: position(marker.mqttTimestamp) + '%' }"
        :title="marker.label"
        @click="onMarkerClick(marker)"
      >
        <i class="fas fa-bookmark"></i>
      </button>
    </div>
    <div class="playhead-track" aria-hidden="true">
      <div class="playhead" :style="{ left: playheadLeft + '%' }" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.event-indicator-stack {
  width: 100%;
  margin-bottom: 4px;
}

.event-indicator {
  pointer-events: none;
  position: relative;
  width: 100%;
  height: 10px;
  background: rgba(0, 112, 17, 0.12);
  border-radius: 4px;

  .event-tick {
    position: absolute;
    height: 100%;
    width: 1px;
    background-color: #007011;
    opacity: 0.55;
  }

  .marker-pin {
    pointer-events: auto;
    position: absolute;
    transform: translateX(-50%);
    top: -2px;
    border: none;
    background: transparent;
    color: #e6a700;
    padding: 0;
    font-size: 12px;
    cursor: pointer;
    line-height: 1;
  }
}

.playhead-track {
  position: relative;
  width: 100%;
  height: 4px;
  margin-top: 2px;

  .playhead {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    background: #3273dc;
    transform: translateX(-50%);
    pointer-events: none;
  }
}
</style>
