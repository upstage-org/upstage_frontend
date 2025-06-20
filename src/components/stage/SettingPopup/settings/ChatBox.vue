<template>
  <div style="width: 500px">
    <ChatInput v-model="message" placeholder="Type message" @keyup.enter="sendChat" />
  </div>
</template>

<script setup lang="ts">
import ChatInput from "components/form/ChatInput.vue";
import { ref } from "vue";
import { useStageStore } from "../../../../stores/stage";

const emit = defineEmits<{
  (e: 'close'): void
}>();

const stageStore = useStageStore();
const message = ref("");

const sendChat = async () => {
  if (message.value.trim()) {
    await stageStore.sendChat(message.value);
    message.value = "";
    emit("close");
  }
};
</script>

<style></style>
