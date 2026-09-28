<script setup lang="ts">
import ChatInput from "components/form/ChatInput.vue";
import { ref } from "vue";
import { useStageStore } from "@stores/pinia/stage";

const emit = defineEmits<{
  (e: "close"): void;
}>();

const stageStore = useStageStore();
const message = ref("");
const sendChat = () => {
  if (message.value.trim()) {
    // `sendChat` fires off the MQTT publish but doesn't await it
    // (true in both Vuex and Pinia); the previous `.then(...)` here
    // was just queued onto a Promise.resolve() inside Vuex's
    // dispatch wrapper. Running the reset inline is functionally
    // identical and avoids an unnecessary microtask hop.
    stageStore.sendChat({ message: message.value });
    message.value = "";
    emit("close");
  }
};
</script>

<template>
  <div style="width: 500px">
    <ChatInput v-model="message" placeholder="Type message" @keyup.enter="sendChat" />
  </div>
</template>

<style></style>
