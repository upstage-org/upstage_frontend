<template>
  <div class="event-indicator">
    <div
      v-for="event in events"
      :key="event.id"
      :style="{ left: position(event) + '%' }"
    ></div>
  </div>
</template>

<script>
import { computed } from "vue";
import { useStore } from "vuex";
export default {
  setup() {
    const store = useStore();
    const events = computed(() => store.getters["stage/replayEffectiveEvents"] ?? []);
    const timestamp = computed(() => store.getters["stage/replayEffectiveTimestamp"]);
    const begin = computed(() => Number(timestamp.value?.begin ?? 0));
    const end = computed(() => Number(timestamp.value?.end ?? 0));
    const duration = computed(() => end.value - begin.value);

    const position = (event) => {
      const d = duration.value;
      if (!d) return 0;
      return (
        ((Number(event.mqttTimestamp) - begin.value) * 100) / d
      );
    };

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
  > div {
    position: absolute;
    height: 100%;
    width: 1px;
    background-color: #007011;
  }
}
</style>
