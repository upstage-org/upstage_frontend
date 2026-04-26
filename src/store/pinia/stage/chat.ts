import { defineStore } from "pinia";
import { reactive, ref } from "vue";
import { randomMessageColor } from "@utils/common";

interface ChatMessage {
  id?: string | number;
  message?: string;
  username?: string;
  color?: string;
  [key: string]: unknown;
}

export const useStageChatStore = defineStore("stage-chat", () => {
  const messages = ref<ChatMessage[]>([]);
  const privateMessages = ref<ChatMessage[]>([]);
  const privateMessage = ref<string>("");
  const settings = reactive({
    color: randomMessageColor(),
    opacity: 0.9,
    fontSize: "14px",
    playerFontSize: "14px",
  });

  const appendMessage = (m: ChatMessage) => {
    messages.value.push(m);
  };
  const appendPrivate = (m: ChatMessage) => {
    privateMessages.value.push(m);
  };
  const clearAll = () => {
    messages.value = [];
    privateMessages.value = [];
    privateMessage.value = "";
  };

  return {
    messages,
    privateMessages,
    privateMessage,
    settings,
    appendMessage,
    appendPrivate,
    clearAll,
  };
});
