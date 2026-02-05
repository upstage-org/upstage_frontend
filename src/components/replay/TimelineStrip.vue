<template>
  <div class="timeline-strip" :title="title">
    <div
      v-for="(event, idx) in events"
      :key="event.id ?? idx"
      class="timeline-strip-marker"
      :style="{ left: position(event) + '%' }"
    />
  </div>
</template>

<script>
import { computed } from "vue";

export default {
  name: "TimelineStrip",
  props: {
    events: { type: Array, default: () => [] },
    begin: { type: Number, required: true },
    end: { type: Number, required: true },
    title: { type: String, default: "" },
  },
  setup(props) {
    const duration = computed(() => (props.end || 0) - (props.begin || 0));
    const position = (event) => {
      const d = duration.value;
      if (!d) return 0;
      const ts = Number(event.mqttTimestamp ?? 0);
      return ((ts - props.begin) * 100) / d;
    };
    return { position };
  },
};
</script>

<style scoped lang="scss">
.timeline-strip {
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  height: 24px;
  position: relative;
  width: 100%;
  min-width: 120px;

  .timeline-strip-marker {
    position: absolute;
    height: 100%;
    width: 2px;
    background-color: #007011;
    top: 0;
    pointer-events: none;
  }
}
</style>
