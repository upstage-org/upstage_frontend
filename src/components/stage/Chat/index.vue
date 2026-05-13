<script>
import { computed, inject, onMounted, ref, watch, watchEffect } from "vue";
import { animate } from "animejs";
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import ChatInput from "components/form/ChatInput.vue";
import Icon from "components/Icon.vue";
import Reaction from "./Reaction.vue";
import Messages from "./Messages.vue";
import ClearChat from "./ClearChat.vue";

export default {
  components: { ChatInput, Reaction, Icon, Messages, ClearChat },
  setup: () => {
    const theContent = ref();
    const stageStore = useStageStore();
    const userStore = useUserStore();
    // Set by views/chat/Layout.vue when this component is mounted
    // inside the standalone /chat/<stage> view. We use it to:
    //   * hide the "Pop out" button (we're already popped out),
    //   * force `chatVisibility` to true so the audience-side toggle
    //     that hides this card on the main stage doesn't also hide
    //     it in the standalone view (where it IS the whole UI),
    //   * skip the collapse / minimise affordance (no reason to
    //     collapse a window that is dedicated to chat).
    const isStandalone = inject("isChatStandalone", false);
    const chatVisibility = computed(
      () => isStandalone || stageStore.settings.chatVisibility,
    );
    const chatDarkMode = computed(() => stageStore.settings.chatDarkMode);

    const popOut = () => {
      // Reuse the same named window per stage so a second click
      // focuses the existing pop-out instead of opening a duplicate.
      // We deliberately do not pass `noopener` because the parent
      // tab benefits from being able to reach the popped-out window
      // (e.g., a future "close pop-out" affordance); the cookie /
      // auth session is shared regardless.
      const stageUrl = stageStore.url;
      if (!stageUrl) return;
      window.open(
        `/chat/${stageUrl}`,
        `upstage-chat-${stageUrl}`,
        "width=420,height=720,resizable=yes,scrollbars=yes",
      );
    };

    stageStore.loadPermission();

    const messages = computed(() => stageStore.chat.messages);
    // `store.state.user.loadingUser` was a broken read after the user
    // module moved to Pinia; Pinia user store has the real flag.
    const loadingUser = computed(() => userStore.loadingUser);
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
        stageStore.sendChat({ message: message.value });
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
      stageStore.openSettingPopup({
        type: "ChatParameters",
      });

    const opacity = computed(() => stageStore.chat.opacity);
    const fontSize = computed(() => stageStore.chat.fontSize);

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
        opacity: stageStore.chat.opacity,
        fontSize: `${incValue}px`,
      };
      stageStore.SET_CHAT_PARAMETERS(parameters);
      setTimeout(() => (theContent.value.scrollTop = theContent.value.scrollHeight));
    };

    const decreaseFontSize = () => {
      let decValue = fontSize.value?.replace("px", "");
      decValue > 1 && decValue--;
      const parameters = {
        opacity: stageStore.chat.opacity,
        fontSize: `${decValue}px`,
      };
      stageStore.SET_CHAT_PARAMETERS(parameters);
    };
    const chatPosition = computed(() => stageStore.chatPosition);
    const canPlay = computed(() => stageStore.canPlay);
    const stageSize = computed(() => stageStore.stageSize);

    watchEffect(() => {
      if (!collapsed.value) {
        messages.value.forEach((message) => {
          if (!message.read) {
            message.read = true;
          }
        });
      }
    });
    const unreadMessages = computed(() => messages.value.filter((message) => !message.read).length);
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
      isStandalone,
      popOut,
    };
  },
};
</script>

<template>
  <transition :css="false" @enter="enter" @leave="leave">
    <div
      v-show="chatVisibility"
      id="chatbox"
      :key="chatPosition"
      class="card is-light"
      :class="{ collapsed, dark: chatDarkMode }"
      :style="{
        opacity,
        fontSize,
        width: `calc(20% + 3*${fontSize}`,
        height: `calc(100vh - ${stageSize.height}px - 64px)`,
        left: chatPosition === 'left' ? (canPlay ? '48px' : '16px') : 'unset',
      }"
    >
      <transition @enter="bounceUnread">
        <a-tooltip :title="`${unreadMessages} new message${unreadMessages > 1 ? 's' : ''}`">
          <span
            v-if="collapsed && unreadMessages"
            :key="unreadMessages"
            class="unread clickable tag is-danger is-small"
            style="position: absolute; left: 12px; top: 6px; background-color: #f14668 !important"
            @click="collapsed = false"
            >{{ unreadMessages }}</span
          >
        </a-tooltip>
      </transition>
      <div class="actions">
        <Reaction v-if="collapsed" />
        <a-tooltip
          v-if="!isStandalone"
          :title="collapsed ? 'Maximise' : 'Minimise'"
        >
          <button
            :key="collapsed"
            class="chat-setting button is-rounded is-outlined"
            @click="collapsed = !collapsed"
          >
            <span class="icon">
              <Icon v-if="collapsed" src="maximise.svg" size="20" />
              <Icon v-else src="minimise.svg" size="24" class="mt-4" />
            </span>
          </button>
        </a-tooltip>
        <!--
          Pop-out into the standalone /chat/<stage> window. Only
          rendered in the main-stage instance of this component;
          the standalone view sets isStandalone=true via provide()
          so the popped-out window doesn't show its own pop-out
          button.
        -->
        <a-tooltip
          v-if="!isStandalone"
          :title="$t('pop_out_chat') || 'Pop out chat'"
        >
          <button class="chat-setting button is-rounded is-outlined" @click="popOut">
            <span class="icon">
              <Icon src="bring-to-front.svg" size="20" />
            </span>
          </button>
        </a-tooltip>
        <a-tooltip v-if="!isStandalone" title="Settings">
          <button class="chat-setting button is-rounded is-outlined" @click="openChatSetting">
            <span class="icon">
              <Icon src="setting.svg" size="32" />
            </span>
          </button>
        </a-tooltip>
        <ClearChat option="public-chat" />
      </div>
      <div ref="theContent" class="card-content">
        <Messages :messages="messages" :style="{ fontSize }" />
      </div>
      <footer class="card-footer">
        <div class="card-footer-item">
          <div v-if="!collapsed" class="is-fullwidth my-1 reaction-bar">
            <Reaction :custom-emoji="true" />
            <div class="font-size-controls">
              <a-tooltip title="Increase font size">
                <button
                  class="button is-small is-rounded mx-1"
                  style="width: 24px; height: 24px; padding: 0px; padding-top: 4px"
                  @click="increateFontSize()"
                >
                  ➕
                </button>
              </a-tooltip>
              <a-tooltip title="Decrease font size">
                <button
                  class="button is-small is-rounded mx-1"
                  style="width: 24px; height: 24px; padding: 0px; padding-top: 4px"
                  @click="decreaseFontSize()"
                >
                  ➖
                </button>
              </a-tooltip>
            </div>
          </div>
          <div class="control has-icons-right is-fullwidth">
            <ChatInput
              v-model="message"
              placeholder="Type message"
              :loading="loadingUser"
              @submit="sendChat"
            />
          </div>
        </div>
      </footer>
    </div>
  </transition>
</template>

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

      > div {
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
