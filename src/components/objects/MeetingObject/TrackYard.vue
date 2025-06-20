<template>
  <div class="yard">
    <Track v-for="track in tracks" :key="track.getId()" :track="track" />
  </div>
</template>

<script setup>
import Track from "components/objects/MeetingObject/Track.vue";
import { computed } from "vue";
import { useStageStore } from "store/modules/stage";

const stageStore = useStageStore();
const tracks = computed(() => stageStore.jitsiTracks);
</script>

<style scoped>
.yard {
  display: flex;
  justify-content: space-around;
}
</style>
