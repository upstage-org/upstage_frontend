<script>
import { inject, ref } from "vue";
import { message } from "ant-design-vue";
import buildClient from "services/mqtt";
import { TOPICS } from "utils/constants";
import { namespaceTopic } from "store/modules/stage/reusable";

const mqttClient = buildClient();

export default {
  setup: () => {
    const stage = inject("stage");
    const refresh = inject("refresh");

    const clearing = ref(false);
    const clearChat = async () => {
      clearing.value = true;
      // `stage` is injected from StageManagement/index.vue, whose getStage
      // query now selects `mqtt` — so this costs no extra request.
      const client = mqttClient.connect(stage.value?.mqtt);
      if (!client) {
        clearing.value = false;
        message.error("Could not reach the chat server. Please reload and try again.");
        return;
      }
      await new Promise((resolve) => {
        client.on("connect", () => {
          const topicChat = namespaceTopic(TOPICS.CHAT, stage.value.fileLocation);
          mqttClient.sendMessage(topicChat, { clear: true }, true);
          mqttClient.sendMessage(topicChat, { clearPlayerChat: true }, true).then(resolve);
        });
      });
      clearing.value = false;
      message.success(`Chat cleared successfully!`);
      refresh(stage.value.id);
    };

    return { clearChat, clearing };
  },
};
</script>

<template>
  <button class="button ml-2 is-warning" :class="{ 'is-loading': clearing }" @click="clearChat">
    Clear Chat
  </button>
</template>

<style></style>
