<template>
  <transition :css="false" @enter="enter" @leave="leave">
    <div id="player-chatbox" ref="theChatbox" v-show="showPlayerChat" class="card is-light"
      :class="{ collapsed, 'is-movingable': isMovingable }" :style="{
        opacity,
        fontSize: playerFontSize,
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
        <ClearChat option="player-chat" />
      </div>
      <div class="card-content" ref="theContent">
        <Messages :messages="privateMessages" :style="{ fontSize: playerFontSize }" />
      </div>
      <footer class="card-footer">
        <div class="card-footer-item">
          <div class="is-fullwidth my-1 reaction-bar">
            <div class="font-size-controls">
              <a-tooltip title="Increase font size">
                <button class="button is-small is-rounded mx-1" @click="increaseFontSize">
                  ➕
                </button>
              </a-tooltip>
              <a-tooltip title="Decrease font size">
                <button class="button is-small is-rounded" @click="decreaseFontSize">
                  ➖
                </button>
              </a-tooltip>
            </div>
          </div>
          <div class="control has-icons-right is-fullwidth">
            <ChatInput v-model="privateMessage" placeholder="Type message" :loading="loadingUser"
              :disabled="isMovingable" @keyup.enter="handleSendChat" />
          </div>
        </div>
      </footer>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { animate } from 'animejs'
import Moveable from 'moveable'
import { useChatStore } from 'stores/chat'
import ChatInput from 'components/form/ChatInput.vue'
import Icon from 'components/Icon.vue'
import Messages from './Messages.vue'
import ClearChat from './ClearChat.vue'
import { storeToRefs } from 'pinia'

// Refs
const theChatbox = ref()
const theContent = ref()
const isMovingable = ref(false)
const collapsed = ref(false)

// Store
const chatStore = useChatStore()
const {
  sendChat: storeSendChat,
  setPlayerChatParameters,
  togglePlayerChat } = chatStore
const {
  privateMessages,
  privateMessage,
  opacity,
  playerFontSize,
  showPlayerChat,
} = storeToRefs(chatStore)

// Computed
const loadingUser = ref(false) // TODO: Move to user store

// Methods
const scrollToEnd = () => {
  animate(theContent.value, {
    scrollTop: theContent.value?.scrollHeight,
    ease: 'inOutQuad',
  })
}

const handleSendChat = () => {
  if (privateMessage.value && !loadingUser.value) {
    storeSendChat(privateMessage.value, true)
    scrollToEnd()
  }
}

const enter = (el: HTMLElement, complete: () => void) => {
  animate(el, {
    scaleY: [0, 1],
    translateX: [-200, 0],
    onComplete: () => {
      scrollToEnd()
      complete()
    },
  })
}

const leave = (el: HTMLElement, complete: () => void) => {
  animate(el, {
    scaleY: 0,
    translateX: -200,
    ease: 'inOutExpo',
    onComplete: complete,
  })
}

const moveable = new Moveable(document.body, {
  draggable: true,
  resizable: true,
  origin: false,
})

const toggleMoveable = () => {
  moveable.setState({
    target: isMovingable.value ? null : theChatbox.value,
  })
  isMovingable.value = !isMovingable.value
}

const minimiseToToolbox = () => {
  togglePlayerChat(false)
  moveable.setState({ target: null })
  isMovingable.value = false
}

const increaseFontSize = () => {
  let incValue = parseInt(playerFontSize.value)
  incValue++
  setPlayerChatParameters({
    playerFontSize: `${incValue}px`
  })
  setTimeout(() => {
    if (theContent.value) {
      theContent.value.scrollTop = theContent.value.scrollHeight
    }
  })
}

const decreaseFontSize = () => {
  let decValue = parseInt(playerFontSize.value)
  if (decValue > 1) {
    decValue--
    setPlayerChatParameters({
      playerFontSize: `${decValue}px`
    })
  }
}

// Lifecycle
onMounted(() => {
  scrollToEnd()

  moveable.on('drag', ({ target, left, top, height }) => {
    target.style.left = `${left}px`
    if (top + height + 8 < (window.innerHeight || document.documentElement.clientHeight)) {
      target.style.top = `${top}px`
    }
  })

  moveable.on('resize', ({ target, width, height, drag: { left, top } }) => {
    if (width > 100) {
      target.style.width = `${width}px`
    }
    if (height > 160) {
      target.style.height = `${height}px`
    }
    target.style.left = `${left}px`
    target.style.top = `${top}px`
  })
})

// Watchers
watch(privateMessages, scrollToEnd)
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
}
</style>
