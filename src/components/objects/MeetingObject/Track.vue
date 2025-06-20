<template>
  <video v-if="isVideo" autoplay ref="el"></video>
  <audio v-else autoplay ref="el"></audio>
</template>

<script setup>
import { onMounted, onUnmounted, ref, computed } from "vue";

const props = defineProps({
  track: {
    type: Object,
    required: true
  }
});

const el = ref();
const isVideo = computed(() => props.track.getType() === "video");

onMounted(() => {
  props.track.attach(el.value);
});

onUnmounted(() => {
  props.track.detach();
});
</script>

<style scoped>
video {
  width: 200px;
  border-radius: 12px;
}
</style>
