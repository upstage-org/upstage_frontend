<template>
  <a-tooltip :title="dynamicTooltip">
    <div style="position: relative" class="has-tooltip-left">
      <ElasticInput v-if="!pickerOnly" v-bind="$attrs" :model-value="modelValue"
        @update:model-value="$emit('update:modelValue', $event)" @ref="(el) => (input = el)" @submit="$emit('submit')"
        :style="{
    'border-top-right-radius': '20px',
    'border-bottom-right-radius': '20px',
    'padding-right': '40px',
  }" :class="dynamicClass" />
      <div v-click-outside="() => (isPicking = false)" class="emoji-picker-wrapper">
        <button type="button" class="button is-right clickable is-rounded" :class="{
    'is-loading': loading,
    'is-primary': !className,
    [className]: true,
    'picker-only': pickerOnly,
  }" :disabled="loading" :style="style" @click="isPicking = !isPicking">
          <slot name="icon">
            <span class="icon" v-if="!loading">
              <Icon size="48" src="emoji.svg" />
            </span>
          </slot>
        </button>
        <transition :css="false" @enter="pickerEnter" @leave="pickerLeave">
          <emoji-picker v-show="isPicking" :class="{ dark: chatDarkMode, light: !chatDarkMode }" :style="emojiPickerStyle" ref="emojiPicker" />
        </transition>
      </div>
    </div>
  </a-tooltip>
</template>

<script>
import "emoji-picker-element";
import { computed, ref, onMounted, nextTick } from "vue";
import { animate } from "animejs";
import Icon from "components/Icon.vue";
import ElasticInput from "components/form/ElasticInput.vue";
import { useStore } from "vuex";
import { useHoldingShift } from "../stage/composable";

export default {
  props: ["loading", "modelValue", "pickerOnly", "style", "className"],
  emits: ["update:modelValue"],
  components: { Icon, ElasticInput },
  setup: (props, { emit }) => {
    const input = ref();
    const isPicking = ref(false);
    const emojiPicker = ref();
    const store = useStore();
    const canPlay = computed(() => store.getters["stage/canPlay"]);
    const chatDarkMode = computed(
      () => store.state.stage.settings.chatDarkMode,
    );

    const isHoldingShift = useHoldingShift();

    const handleEmoji = ({ detail: { unicode } }) => {
      if (props.pickerOnly) {
        emit("update:modelValue", unicode);
      } else {
        const start = input.value.selectionStart;
        const end = input.value.selectionEnd;
        const value = props.modelValue ?? "";
        emit(
          "update:modelValue",
          `${value.substring(0, start)}${unicode}${value.substring(
            end,
            value.length,
          )}`,
        );
      }
      if (!isHoldingShift.value) {
        isPicking.value = false;
      }
    };
    const pickerLeave = () => {
      if (input.value) {
        input.value.focus();
      }
    };
    const behavior = computed(() => {
      if (props.modelValue) {
        if (props.modelValue.startsWith(":")) {
          return "think";
        }
        if (props.modelValue.startsWith("!")) {
          return "shout";
        }
        if (canPlay.value && props.modelValue.startsWith("-")) {
          return "audience";
        }
      }
      return "speak";
    });
    const dynamicClass = computed(() => {
      return {
        think: "has-background-info-light has-text-info",
        shout: "has-background-danger-light has-text-danger",
        audience: "has-background-dark has-text-light",
      }[behavior.value];
    });
    const dynamicTooltip = computed(() => {
      return {
        think: "Think",
        shout: "Shout",
        audience: "Audience simulation",
      }[behavior.value];
    });

    // Detect chat position for responsive emoji picker  
    const detectChatPosition = () => {
      return new Promise((resolve) => {
        nextTick(() => {
          // Find the closest chat container to this ChatInput
          let currentElement = input.value;
          let chatBox = null;
          let chatPosition = 'right'; // Default fallback
          
          // Traverse up the DOM to find the closest chat container
          while (currentElement && currentElement !== document.body) {
            if (currentElement.id === 'player-chatbox') {
              chatBox = currentElement;
              console.log('🎭 Found PlayerChat container');
              break;
            }
            if (currentElement.id === 'chatbox') {
              chatBox = currentElement;
              console.log('💬 Found PublicChat container');
              break;
            }
            currentElement = currentElement.parentElement;
          }
          
          // Fallback: if not found in DOM traversal, use global detection
          if (!chatBox) {
            console.log('🔍 Fallback to global detection...');
            // Only use public chat as fallback since player chat should be within DOM tree
            const publicChat = document.querySelector('#chatbox');
            if (publicChat && window.getComputedStyle(publicChat).display !== 'none') {
              chatBox = publicChat;
              console.log('💬 Fallback: Found PublicChat');
            }
          }
          
          if (chatBox) {
            const rect = chatBox.getBoundingClientRect();
            const windowWidth = window.innerWidth;
            const chatCenterX = rect.left + rect.width / 2;
            
            console.log(`📏 Chat Box Info:`, {
              chatId: chatBox.id,
              left: rect.left,
              width: rect.width,
              centerX: chatCenterX,
              windowWidth,
              centerOfScreen: windowWidth / 2
            });
            
            chatPosition = chatCenterX > windowWidth / 2 ? 'right' : 'left';
            console.log(`🎯 Chat Position: ${chatPosition}`);
          } else {
            console.log('❌ No chat box found, using default');
          }
          
          console.log(`🎪 Final emoji picker position: ${chatPosition}`);
          resolve(chatPosition);
        });
      });
    };

    const emojiPickerStyle = ref({});
    
    const updateEmojiPickerPosition = async () => {
      const chatPosition = await detectChatPosition();
      
      console.log(`🎨 Updating emoji picker for chat position: ${chatPosition}`);
      
      if (chatPosition === 'right') {
        // Chat is on the right, emoji picker should open to the left
        emojiPickerStyle.value = {
          '--emoji-transform-origin': 'bottom right',
          right: '0px',
          left: 'auto'
        };
        console.log('📝 Setting emoji picker to LEFT (chat on right)');
      } else {
        // Chat is on the left, emoji picker should open to the right
        emojiPickerStyle.value = {
          '--emoji-transform-origin': 'bottom left',
          left: '0px', 
          right: 'auto'
        };
        console.log('📝 Setting emoji picker to RIGHT (chat on left)');
      }
      
      console.log('🎯 Final style:', emojiPickerStyle.value);
    };

    const pickerEnter = async (el, complete) => {
      await updateEmojiPickerPosition();
      el.addEventListener("emoji-click", handleEmoji);
      el.shadowRoot.querySelector("#search").placeholder =
        'Hold "Shift" key to select multiple';
      
      // Apply positioning to the element
      Object.assign(el.style, emojiPickerStyle.value);
      
      animate(el, {
        scaleX: [0, 1],
        scaleY: [0, 1],
        duration: 500,
        onComplete: complete,
      });
    };

    return {
      input,
      isPicking,
      emojiPicker,
      pickerEnter,
      pickerLeave,
      dynamicClass,
      dynamicTooltip,
      chatDarkMode,
      emojiPickerStyle,
    };
  },
};
</script>

<style scoped lang="scss">
emoji-picker {
  --border-size: 0.5px;
  --outline-size: 0;
  --input-border-radius: 24px;
  --input-border-color: #b5b5b5;

  position: absolute;
  bottom: 40px;
  z-index: 1000;
  overflow: hidden;
  border-radius: 8px;
  box-shadow:
    0 0.5em 1em -0.125em rgba(10, 10, 10, 0.1),
    0 0px 0 1px rgba(10, 10, 10, 0.02);
  transform-origin: var(--emoji-transform-origin, bottom left);
}

.emoji-picker-wrapper {
  position: absolute;
  right: 0;
  top: 0;

  .button {
    .icon:first-child:last-child {
      margin: auto;
    }
  }
}
</style>
