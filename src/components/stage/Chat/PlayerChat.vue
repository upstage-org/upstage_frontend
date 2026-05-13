<script>
import { computed, inject, onMounted, ref, watch } from "vue";
import { animate } from "animejs";
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
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
    const stageStore = useStageStore();
    const userStore = useUserStore();
    // Set by views/chat/Layout.vue. When true:
    //   * the Moveable.js draggable handle is not bound (no on-stage
    //     dragging makes sense — the host browser window is the
    //     drag target instead),
    //   * the click-and-drag fallback (`startDrag`) is also skipped,
    //   * the minimise / move-to-toolbox / pop-out buttons in the
    //     actions row are hidden (this view IS the whole UI),
    //   * the floating-card positioning is replaced via :deep CSS
    //     in the parent Layout.vue so the chat fills its pane.
    const isStandalone = inject("isChatStandalone", false);

    const messages = computed(() => stageStore.chat.privateMessages);
    // `store.state.user.loadingUser` was a broken read after the user
    // module moved to Pinia (Vuex root has no `user` slot). Pinia user
    // store has the real flag.
    const loadingUser = computed(() => userStore.loadingUser);
    const chat = stageStore.chat;
    const message = computed(() => stageStore.chat.privateMessage);
    const scrollToEnd = () => {
      animate(theContent.value, {
        scrollTop: theContent.value?.scrollHeight,
        ease: "inOutQuad",
      });
    };
    const sendChat = () => {
      if (message.value.trim() && !loadingUser.value) {
        stageStore.sendChat({
          message: message.value,
          isPrivate: true,
        });
        chat.privateMessage = "";
        scrollToEnd();
      }
    };
    watch(messages.value, scrollToEnd);
    onMounted(scrollToEnd);

    const opacity = computed(() => stageStore.chat.opacity);
    const fontSize = computed(() => stageStore.chat.playerFontSize);

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

    // Moveable.js instance is created lazily so the standalone view
    // (no on-stage dragging) doesn't pay the cost of instantiating
    // it. `null` sentinel means "no draggable available" — the
    // toggle / minimise handlers below short-circuit accordingly.
    let moveable = null;

    onMounted(() => {
      if (isStandalone) return;
      moveable = new Moveable(document.body, {
        draggable: true,
        resizable: true,
        origin: false,
      });
      moveable.on("drag", ({ target, left, top, height }) => {
        target.style.left = `${left}px`;
        if (top + height + 8 < (window.innerHeight || document.documentElement.clientHeight)) {
          target.style.top = `${top}px`;
        }
      });
      moveable.on("resize", ({ target, width, height, drag: { left, top } }) => {
        // console.log(left, top);
        if (width > 100) {
          target.style.width = `${width}px`;
        }
        if (height > 160) {
          target.style.height = `${height}px`;
        }
        target.style.left = `${left}px`;
        target.style.top = `${top}px`;
      });
    });

    const collapsed = ref(false);
    const isMovingable = ref(false);

    const toggleMoveable = () => {
      if (!moveable) return;
      moveable.setState({
        target: isMovingable.value ? null : theChatbox.value,
      });
      isMovingable.value = !isMovingable.value;
    };

    // In the standalone view the player chat is always rendered (the
    // tab bar in views/chat/Layout.vue gates visibility instead);
    // forcing the computed to `true` there bypasses the on-stage
    // toolbox-toggle state that would otherwise leave the player
    // chat hidden in the popped-out window.
    const playerChatVisibility = computed(
      () => isStandalone || stageStore.showPlayerChat,
    );
    const minimiseToToolbox = () => {
      // Pinia rename: action `showPlayerChat` → `setShowPlayerChat`
      // (collided with same-named state ref in Pinia setup store).
      stageStore.setShowPlayerChat(false);
      if (moveable) moveable.setState({ target: null });
      isMovingable.value = false;
    };

    const popOut = () => {
      const stageUrl = stageStore.url;
      if (!stageUrl) return;
      // Same target name as the public Chat pop-out so clicking
      // either button reuses one window per stage. The popped-out
      // view itself decides which pane to show via its tab bar.
      window.open(
        `/chat/${stageUrl}`,
        `upstage-chat-${stageUrl}`,
        "width=420,height=720,resizable=yes,scrollbars=yes",
      );
    };

    const increateFontSize = () => {
      let incValue = fontSize.value?.replace("px", "");
      incValue++;
      const parameters = {
        playerFontSize: `${incValue}px`,
      };
      stageStore.SET_PLAYER_CHAT_PARAMETERS(parameters);
      setTimeout(() => (theContent.value.scrollTop = theContent.value.scrollHeight));
    };

    const decreaseFontSize = () => {
      let decValue = fontSize.value?.replace("px", "");
      decValue > 1 && decValue--;
      const parameters = {
        playerFontSize: `${decValue}px`,
      };
      stageStore.SET_PLAYER_CHAT_PARAMETERS(parameters);
    };

    // Click and drag functionality. Unified mouse + touch implementation
    // so the player chat is draggable on tablets without relying on
    // browser mouse-event synthesis (which doesn't fire during
    // touchmove). DOM-mutation style is preserved (rather than
    // reactive Pinia state) because Moveable.js also writes
    // .style.left/top directly when the move-toggle button is on;
    // sharing the same mutation channel keeps the two affordances
    // consistent.
    const startDrag = (e) => {
      if (isStandalone) return;
      e.preventDefault();

      const chatbox = theChatbox.value;
      if (!chatbox) return;

      const isTouch = "touches" in e;
      const startClientX = isTouch ? e.touches[0].clientX : e.clientX;
      const startClientY = isTouch ? e.touches[0].clientY : e.clientY;

      const rect = chatbox.getBoundingClientRect();
      const startX = startClientX - rect.left;
      const startY = startClientY - rect.top;

      const move = (clientX, clientY) => {
        const newX = clientX - startX;
        const newY = clientY - startY;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const clampedX = Math.max(0, Math.min(newX, windowWidth - rect.width));
        const clampedY = Math.max(0, Math.min(newY, windowHeight - rect.height));
        chatbox.style.left = `${clampedX}px`;
        chatbox.style.top = `${clampedY}px`;
        chatbox.style.position = "fixed";
      };

      const handleMouseMove = (ev) => move(ev.clientX, ev.clientY);
      const handleTouchMove = (ev) => {
        if (!ev.touches[0]) return;
        // `preventDefault` here keeps iOS Safari from scroll-bouncing
        // the page while the user is dragging the chat. Skipped on
        // mouse because mouse drag doesn't trigger page scroll.
        ev.preventDefault();
        move(ev.touches[0].clientX, ev.touches[0].clientY);
      };

      const cleanup = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", cleanup);
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", cleanup);
        document.removeEventListener("touchcancel", cleanup);
      };

      if (isTouch) {
        document.addEventListener("touchmove", handleTouchMove, { passive: false });
        document.addEventListener("touchend", cleanup);
        document.addEventListener("touchcancel", cleanup);
      } else {
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", cleanup);
      }
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
      isStandalone,
      popOut,
    };
  },
};
</script>

<template>
  <transition :css="false" @enter="enter" @leave="leave">
    <div
      v-show="playerChatVisibility"
      id="player-chatbox"
      ref="theChatbox"
      class="card is-light"
      :class="{ collapsed, 'is-movingable': isMovingable }"
      :style="{
        opacity,
        fontSize,
      }"
    >
      <div class="actions">
        <!--
          On-stage chrome (minimise to toolbox, Moveable.js toggle,
          custom drag handle) only makes sense in the in-stage
          floating-card view. The standalone /chat/<stage> window
          uses the host OS window manager for positioning, so we
          drop all three buttons there.
        -->
        <button
          v-if="!isStandalone"
          class="chat-setting button is-rounded is-outlined"
          @click="minimiseToToolbox"
        >
          <span class="icon">
            <Icon v-if="collapsed" src="maximise.svg" size="20" />
            <Icon v-else src="minimise.svg" size="24" class="mt-4" />
          </span>
        </button>
        <button
          v-if="!isStandalone"
          class="chat-setting button is-rounded is-outlined"
          :class="{ 'has-background-primary-light': isMovingable }"
          @click="toggleMoveable"
        >
          <span class="icon">
            <Icon src="prop.svg" size="20" />
          </span>
        </button>
        <button
          v-if="!isStandalone"
          class="chat-setting button is-rounded is-outlined drag-icon-button"
          @mousedown.prevent="startDrag"
          @touchstart.prevent="startDrag"
        >
          <span class="icon">
            <Icon src="movement-slider.svg" size="20" />
          </span>
        </button>
        <!--
          Pop the player chat out into the standalone /chat/<stage>
          window for a multi-screen setup. Shares the same target
          window name as the public Chat pop-out so we never have
          two duplicate windows per stage.
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
        <ClearChat option="player-chat" />
      </div>
      <div ref="theContent" class="card-content">
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
                <button class="button is-small is-rounded" @click="decreaseFontSize()">➖</button>
              </a-tooltip>
            </div>
          </div>
          <div class="control has-icons-right is-fullwidth">
            <ChatInput
              v-model="chat.privateMessage"
              placeholder="Type message"
              :loading="loadingUser"
              :disabled="isMovingable"
              @submit="sendChat"
            />
          </div>
        </div>
      </footer>
    </div>
  </transition>
</template>

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
