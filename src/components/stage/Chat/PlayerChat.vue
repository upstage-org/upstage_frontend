<template>
  <transition :css="false" @enter="enter" @leave="leave">
    <div id="player-chatbox" ref="theChatbox" v-show="playerChatVisibility" class="card is-light"
      :class="{ collapsed, 'is-movingable': isMovingable }" :style="{
    opacity,
    fontSize,
  }">
      <div class="actions">
        <button class="chat-setting button is-rounded is-outlined" @click="minimiseToToolbox">
          <span class="icon">
            <Icon v-if="collapsed" src="maximise.svg" size="20" />
            <Icon v-else src="minimise.svg" size="24" class="mt-4" />
          </span>
        </button>
        <button class="chat-setting button is-rounded is-outlined"
          :class="{ 'has-background-primary-light': isMovingable }" @click="toggleMoveable">
          <span class="icon">
            <Icon src="prop.svg" size="20" />
          </span>
        </button>
        <button class="chat-setting button is-rounded is-outlined drag-icon-button"
          @mousedown.prevent="startDrag">
          <span class="icon">
            <Icon src="movement-slider.svg" size="20" />
          </span>
        </button>
        <ClearChat option="player-chat" />
      </div>
      <div class="card-content" ref="theContent">
        <Messages :messages="messages" :style="{ fontSize }" />
      </div>
      <footer class="card-footer">
        <div class="card-footer-item">
          <div class="is-fullwidth my-1 reaction-bar">
            <div class="font-size-controls">
              <a-tooltip title="Increase font size">
                <button class="button is-small is-rounded mx-1" @click="increateFontSize()">
                  ➕
                </button>
              </a-tooltip>
              <a-tooltip title="Decrease font size">
                <button class="button is-small is-rounded" @click="decreaseFontSize()">
                  ➖
                </button>
              </a-tooltip>
            </div>
          </div>
          <div class="control has-icons-right is-fullwidth">
            <ChatInput v-model="chat.privateMessage" placeholder="Type message" :loading="loadingUser"
              :disabled="isMovingable" @submit="sendChat" />
          </div>
        </div>
      </footer>
    </div>
  </transition>
</template>

<script>
import { computed, onMounted, ref, watch } from "vue";
import { animate } from "animejs";
import { useStore } from "vuex";
import ChatInput from "components/form/ChatInput.vue";
import Icon from "components/Icon.vue";
import Messages from "./Messages.vue";
import Moveable from "moveable";
import ClearChat from "./ClearChat.vue";

export default {
  components: { ChatInput, Icon, Messages, ClearChat },
  setup: () => {
    const theChatbox = ref();
    const theContent = ref();
    const store = useStore();

    const messages = computed(() => store.state.stage.chat.privateMessages);
    const loadingUser = computed(() => store.state.user.loadingUser);
    const chat = store.state.stage.chat;
    const message = computed(() => store.state.stage.chat.privateMessage);
    const scrollToEnd = () => {
      animate(theContent.value, {
        scrollTop: theContent.value?.scrollHeight,
        ease: "inOutQuad",
      });
    };
    const sendChat = () => {
      if (message.value.trim() && !loadingUser.value) {
        store.dispatch("stage/sendChat", {
          message: message.value,
          isPrivate: true,
        });
        chat.privateMessage = "";
        scrollToEnd();
      }
    };
    watch(messages.value, scrollToEnd);
    onMounted(scrollToEnd);

    const opacity = computed(() => store.state.stage.chat.opacity);
    const fontSize = computed(() => store.state.stage.chat.playerFontSize);

    const enter = (el, complete) => {
      animate(el, {
        scaleY: [0, 1],
        translateX: [-200, 0],
        onComplete: () => {
          scrollToEnd();
          complete();
        },
      });
    };
    const leave = (el, complete) => {
      animate(el, {
        scaleY: 0,
        translateX: -200,
        ease: "inOutExpo",
        onComplete: complete,
      });
    };

    const moveable = new Moveable(document.body, {
      draggable: true,
      resizable: true,
      origin: false,
    });

    onMounted(() => {
      moveable.on("drag", ({ target, left, top, height }) => {
        target.style.left = `${left}px`;
        if (
          top + height + 8 <
          (window.innerHeight || document.documentElement.clientHeight)
        ) {
          target.style.top = `${top}px`;
        }
      });
      moveable.on(
        "resize",
        ({ target, width, height, drag: { left, top } }) => {
          // console.log(left, top);
          if (width > 100) {
            target.style.width = `${width}px`;
          }
          if (height > 160) {
            target.style.height = `${height}px`;
          }
          target.style.left = `${left}px`;
          target.style.top = `${top}px`;
        },
      );
    });

    const collapsed = ref(false);
    const isMovingable = ref(false);
    const canDrag = ref(false);
    
    const toggleMoveable = () => {
      moveable.setState({
        target: isMovingable.value ? null : theChatbox.value,
      });
      isMovingable.value = !isMovingable.value;
    };
    
    const toggleDragMode = () => {
      canDrag.value = !canDrag.value;
      
      // Disable moveable mode when enabling drag mode
      if (canDrag.value && isMovingable.value) {
        isMovingable.value = false;
        moveable.setState({ target: null });
      }
    };

    const playerChatVisibility = computed(
      () => store.state.stage.showPlayerChat,
    );
    const minimiseToToolbox = () => {
      store.dispatch("stage/showPlayerChat", false);
      moveable.setState({ target: null });
      isMovingable.value = false;
    };

    const increateFontSize = () => {
      let incValue = fontSize.value?.replace("px", "");
      incValue++;
      const parameters = {
        playerFontSize: `${incValue}px`,
      };
      store.commit("stage/SET_PLAYER_CHAT_PARAMETERS", parameters);
      setTimeout(
        () => (theContent.value.scrollTop = theContent.value.scrollHeight),
      );
    };

    const decreaseFontSize = () => {
      let decValue = fontSize.value?.replace("px", "");
      decValue > 1 && decValue--;
      const parameters = {
        playerFontSize: `${decValue}px`,
      };
      store.commit("stage/SET_PLAYER_CHAT_PARAMETERS", parameters);
    };

    // Click and drag functionality
    const startDrag = (e) => {
      e.preventDefault();
      
      const chatbox = theChatbox.value;
      if (!chatbox) return;
      
      
      // Get current computed styles
      const rect = chatbox.getBoundingClientRect();
      let startX = e.clientX - rect.left;
      let startY = e.clientY - rect.top;
      
      const handleMouseMove = (moveEvent) => {
        const newX = moveEvent.clientX - startX;
        const newY = moveEvent.clientY - startY;
        
        // Boundary checks
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const clampedX = Math.max(0, Math.min(newX, windowWidth - rect.width));
        const clampedY = Math.max(0, Math.min(newY, windowHeight - rect.height));
        
        chatbox.style.left = `${clampedX}px`;
        chatbox.style.top = `${clampedY}px`;
        chatbox.style.position = 'fixed';
        
      };
      
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
      
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

    return {
      messages,
      message,
      sendChat,
      theChatbox,
      theContent,
      loadingUser,
      opacity,
      fontSize,
      playerChatVisibility,
      enter,
      leave,
      toggleMoveable,
      isMovingable,
      minimiseToToolbox,
      chat,
      increateFontSize,
      decreaseFontSize,
      startDrag,
      collapsed,
    };
  },
};
</script>

<style lang="scss" scoped>
#player-chatbox {
  display: flex;
  flex-direction: column;
  position: fixed;
  left: 56px;
  bottom: 16px;
  height: 230px;
  max-width: 222px;
  overflow: visible;
  z-index: 3;

  .card-content {
    flex-grow: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-top: 36px;
  }

  .card-footer-item {
    flex-wrap: wrap;
    padding-top: 0px;
    padding-bottom: 6px;
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

  .drag-icon-button {
    cursor: grab;
    
    &:active {
      cursor: grabbing;
      background-color: rgba(255, 0, 0, 0.2) !important;
    }
    
    &:hover {
      background-color: rgba(255, 0, 0, 0.1) !important;
    }
  }
}
</style>
