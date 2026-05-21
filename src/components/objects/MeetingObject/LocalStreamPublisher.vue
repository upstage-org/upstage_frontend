<script setup>
/**
 * Invisible session host for local camera/mic tracks. Lives under Shell in
 * the live layout so closing the Meeting toolbox does not tear down WebRTC
 * while jitsi objects remain on the board.
 */
import { provide } from "vue";
import { useLocalStreamPublisher } from "./localStreamPublisher";

defineOptions({ name: "LocalStreamPublisher" });

const api = useLocalStreamPublisher();
provide("localStreamPublisher", api);
</script>

<template>
  <span class="local-stream-publisher-host" aria-hidden="true" />
</template>

<style scoped>
.local-stream-publisher-host {
  display: none;
}
</style>
