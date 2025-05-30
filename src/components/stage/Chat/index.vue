<template>
  <transition :css="false" @enter="enter" @leave="leave">
    <div id="chatbox" :key="chatPosition" v-show="chatVisibility" class="card is-light"
      :class="{ collapsed, dark: chatDarkMode }" :style="{
    opacity,
    fontSize,
    width: `calc(20% + 3*${fontSize}`,
    height: `calc(100vh - ${stageSize.height}px - 64px)`,
    left: chatPosition === 'left' ? (canPlay ? '48px' : '16px') : 'unset',
  }">
      <transition @enter="bounceUnread">
        <a-tooltip :title="`${unreadMessages} new message${unreadMessages > 1 ? 's' : ''
    }`">
          <span v-if="collapsed && unreadMessages" :key="unreadMessages" class="unread clickable tag is-danger is-small"
            @click="collapsed = false"
            style="position: absolute;
            left: 12px;
            top: 6px;
            background-color: #f14668 !important;
            "
            >{{ unreadMessages }}</span>
        </a-tooltip>
      </transition>
      <div class="actions">
        <Reaction v-if="collapsed" />
        <a-tooltip :title="collapsed ? 'Maximise' : 'Minimise'">
          <button class="chat-setting button is-rounded is-outlined" @click="collapsed = !collapsed" :key="collapsed">
            <span class="icon">
              <Icon v-if="collapsed" src="maximise.svg" size="20" />
              <Icon v-else src="minimise.svg" size="24" class="mt-4" />
            </span>
          </button>
        </a-tooltip>
        <a-tooltip title="Settings">
          <button class="chat-setting button is-rounded is-outlined" @click="openChatSetting">
            <span class="icon">
              <Icon src="setting.svg" size="32" />
            </span>
          </button>
        </a-tooltip>
        <ClearChat option="public-chat" />
      </div>
      <div class="card-content" ref="theContent">
        <Messages :messages="messages" :style="{ fontSize }" />
      </div>
      <footer class="card-footer">
        <div class="card-footer-item">
          <div v-if="!collapsed" class="is-fullwidth my-1 reaction-bar">
            <Reaction :custom-emoji="true" />
            <div class="font-size-controls">
              <a-tooltip title="Increase font size">
                <button class="button is-small is-rounded mx-1" @click="increateFontSize()" style="width: 24px; height:24px; padding:0px; padding-top:4px;">
                  ➕
                </button>
              </a-tooltip>
              <a-tooltip title="Decrease font size">
                <button class="button is-small is-rounded mx-1" @click="decreaseFontSize()" style="width: 24px; height:24px; padding:0px; padding-top:4px;">
                  ➖
                </button>
              </a-tooltip>
            </div>
          </div>
          <div class="control has-icons-right is-fullwidth">
            <ChatInput v-model="message" placeholder="Type message" :loading="loadingUser" @submit="sendChat" />
          </div>
        </div>
      </footer>
    </div>
  </transition>
</template>

<script>
import { computed, onMounted, ref, watch, watchEffect } from "vue";
import { animate } from "animejs";
import { useStore } from "vuex";
import ChatInput from "components/form/ChatInput.vue";
import Icon from "components/Icon.vue";
import Reaction from "./Reaction.vue";
import Messages from "./Messages.vue";
import ClearChat from "./ClearChat.vue";

export default {
  components: { ChatInput, Reaction, Icon, Messages, ClearChat },
  setup: () => {
    const theContent = ref();
    const store = useStore();
    const chatVisibility = computed(
      () => store.state.stage.settings.chatVisibility,
    );
    const chatDarkMode = computed(
      () => store.state.stage.settings.chatDarkMode,
    );

    store.dispatch("stage/loadPermission");

    const messages = computed(() => store.state.stage.chat.messages);
    const loadingUser = computed(() => store.state.user.loadingUser);
    const message = ref("");
    const collapsed = ref(false);
    const scrollToEnd = () => {
      animate(theContent.value, {
        scrollTop: theContent.value?.scrollHeight,
        ease: "inOutQuad",
      });
    };
    const sendChat = () => {
      if (message.value.trim() && !loadingUser.value) {
        store.dispatch("stage/sendChat", { message: message.value });
        message.value = "";
        scrollToEnd();
      }
    };
    onMounted(scrollToEnd);
    watch(messages.value, scrollToEnd);
    watch(collapsed, (val) => {
      if (!val) {
        setTimeout(() => {
          scrollToEnd();
        });
      }
    });

    const openChatSetting = () =>
      store.dispatch("stage/openSettingPopup", {
        type: "ChatParameters",
      });

    const opacity = computed(() => store.state.stage.chat.opacity);
    const fontSize = computed(() => store.state.stage.chat.fontSize);

    const enter = (el, complete) => {
      animate(el, {
        scale: [0, 1],
        translateY: [-200, 0],
        onComplete: complete,
      });
    };
    const leave = (el, complete) => {
      animate(el, {
        scale: 0,
        translateY: -200,
        onComplete: complete,
      });
    };

    const increateFontSize = () => {
      let incValue = fontSize.value?.replace("px", "");
      incValue++;
      const parameters = {
        opacity: store.state.stage.chat.opacity,
        fontSize: `${incValue}px`,
      };
      store.commit("stage/SET_CHAT_PARAMETERS", parameters);
      setTimeout(
        () => (theContent.value.scrollTop = theContent.value.scrollHeight),
      );
    };

    const decreaseFontSize = () => {
      let decValue = fontSize.value?.replace("px", "");
      decValue > 1 && decValue--;
      const parameters = {
        opacity: store.state.stage.chat.opacity,
        fontSize: `${decValue}px`,
      };
      store.commit("stage/SET_CHAT_PARAMETERS", parameters);
    };
    const chatPosition = computed(() => store.state.stage.chatPosition);
    const canPlay = computed(() => store.getters["stage/canPlay"]);
    const stageSize = computed(() => store.getters["stage/stageSize"]);

    watchEffect(() => {
      if (!collapsed.value) {
        messages.value.forEach((message) => {
          if (!message.read) {
            message.read = true;
          }
        });
      }
    });
    const unreadMessages = computed(
      () => messages.value.filter((message) => !message.read).length,
    );
    const bounceUnread = (el) => {
      {
        animate(el, {
          scale: [1.2, 1],
          duration: 1000,
        });
      }
    };

    return {
      messages,
      message,
      sendChat,
      theContent,
      loadingUser,
      openChatSetting,
      collapsed,
      opacity,
      fontSize,
      chatVisibility,
      chatDarkMode,
      enter,
      leave,
      increateFontSize,
      decreaseFontSize,
      chatPosition,
      canPlay,
      stageSize,
      unreadMessages,
      bounceUnread,
    };
  },
};
</script>

<style lang="scss" scoped>
#chatbox {
  display: flex;
  flex-direction: column;
  position: fixed;
  min-width: 300px;
  bottom: 16px;
  right: 16px;
  overflow: visible;
  z-index: 3;

  @media only screen and (orientation: landscape) {
    height: calc(100% - 135px) !important;
  }

  @media only screen and (orientation: portrait) {
    width: calc(100vw - 32px) !important;

    .actions,
    .card-content,
    .card-footer {
      zoom: 3;
    }

    .actions {
      button:first-child {
        display: none;
      }
    }
  }

  .card-content {
    flex-grow: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-top: 36px;
  }

  .card-footer-item {
    flex-wrap: wrap;
    padding-top: 0;
  }

  &.dark {
    background-color: #303030;
    color: #ffffff;

    .card-footer {
      border-top: 0.5px solid black;
    }

    :deep(.tag),
    :deep(.button),
    :deep(.textarea) {
      background-color: #303030 !important;
      border-color: #303030;
      color: #fff;
    }

    :deep(.textarea::placeholder) {
      color: #ddd;
    }

    :deep(img) {
      filter: invert(100%) hue-rotate(180deg);
    }

    :deep(.guest .tag) {
      color: #fff;
    }

    .unread {
      background-color: #cc0f35 !important;
    }
  }

  &.collapsed {
    height: 108px !important;

    .card-content {
      padding: 0;
      height: 0;

      >div {
        display: none;
      }
    }

    .card-footer-item {
      padding-top: 6px;
    }

    .actions {
      top: 5px;
    }
  }

  .actions {
    position: absolute;
    right: 24px;
    top: 10px;
    z-index: 1;

    button {
      width: 26px;
      height: 26px;
      padding: 0;
      margin-left: 6px;
    }
  }

  .control.has-icons-right .input {
    padding-right: 50px !important;
  }

  .unread {
    position: absolute;
    left: 12px;
    top: 6px;
  }
}

.reaction-bar {
  height: 30px;
  position: relative;

  .font-size-controls {
    position: absolute;
    top: 0;
    right: 0;

    .button.is-rounded {
      width: 16px;
    }
  }
}
</style>
