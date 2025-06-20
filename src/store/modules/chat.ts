import { defineStore } from 'pinia';
import buildClient from 'services/mqtt';
import { TOPICS } from 'constants/index';
import { namespaceTopic } from './stage/reusable';
import { message } from 'ant-design-vue';

const mqttClient = buildClient();

interface ChatState {
  showClearChatSetting: boolean;
  clearing: boolean;
}

export const useChatStore = defineStore('chat', {
  state: (): ChatState => ({
    showClearChatSetting: false,
    clearing: false,
  }),

  actions: {
    setShowClearChatSetting(value: boolean) {
      this.showClearChatSetting = value;
    },

    async clearChat(stageUrl: string, option: string) {
      this.clearing = true;
      try {
        await new Promise((resolve) => {
          (mqttClient as any).connect().on('connect', () => {
            const topicChat = namespaceTopic(TOPICS.CHAT, stageUrl);
            if (option === 'public-chat') {
              mqttClient
                .sendMessage(topicChat, { clear: true }, true)
                .then(resolve);
            } else {
              mqttClient
                .sendMessage(topicChat, { clearPlayerChat: true }, true)
                .then(resolve);
            }
          });
        });

        if (option === 'public-chat') {
          message.success('Chat cleared successfully!');
        } else {
          message.success('Player chat cleared successfully!');
        }
      } finally {
        this.clearing = false;
      }
    },
  },
}); 