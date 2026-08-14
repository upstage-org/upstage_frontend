<script>
import "emoji-picker-element";
import { computed, ref, nextTick } from "vue";
import { animate } from "animejs";
import Icon from "components/Icon.vue";
import ElasticInput from "components/form/ElasticInput.vue";
import { useStageStore } from "@stores/pinia/stage";
import { useHoldingShift } from "../stage/composable";

export default {
  components: { Icon, ElasticInput },
  props: {
    loading: Boolean,
    modelValue: String,
    pickerOnly: Boolean,
    style: [String, Object],
    className: String,
  },
  emits: ["update:modelValue", "submit"],
  setup: (props, { emit }) => {
    const input = ref();
    const isPicking = ref(false);
    const emojiPicker = ref();
    const stageStore = useStageStore();
    const canPlay = computed(() => stageStore.canPlay);
    const chatDarkMode = computed(() => stageStore.settings.chatDarkMode);

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
          `${value.substring(0, start)}${unicode}${value.substring(end, value.length)}`,
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
          let chatPosition = "right"; // Default fallback

          // Traverse up the DOM to find the closest chat container
          while (currentElement && currentElement !== document.body) {
            if (currentElement.id === "player-chatbox") {
              chatBox = currentElement;
              console.log("🎭 Found PlayerChat container");
              break;
            }
            if (currentElement.id === "chatbox") {
              chatBox = currentElement;
              console.log("💬 Found PublicChat container");
              break;
            }
            currentElement = currentElement.parentElement;
          }

          // Fallback: if not found in DOM traversal, use global detection
          if (!chatBox) {
            console.log("🔍 Fallback to global detection...");
            // Only use public chat as fallback since player chat should be within DOM tree
            const publicChat = document.querySelector("#chatbox");
            if (publicChat && window.getComputedStyle(publicChat).display !== "none") {
              chatBox = publicChat;
              console.log("💬 Fallback: Found PublicChat");
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
              centerOfScreen: windowWidth / 2,
            });

            chatPosition = chatCenterX > windowWidth / 2 ? "right" : "left";
            console.log(`🎯 Chat Position: ${chatPosition}`);
          } else {
            console.log("❌ No chat box found, using default");
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

      if (chatPosition === "right") {
        // Chat is on the right, emoji picker should open to the left
        emojiPickerStyle.value = {
          "--emoji-transform-origin": "bottom right",
          right: "0px",
          left: "auto",
        };
        console.log("📝 Setting emoji picker to LEFT (chat on right)");
      } else {
        // Chat is on the left, emoji picker should open to the right
        emojiPickerStyle.value = {
          "--emoji-transform-origin": "bottom left",
          left: "0px",
          right: "auto",
        };
        console.log("📝 Setting emoji picker to RIGHT (chat on left)");
      }

      console.log("🎯 Final style:", emojiPickerStyle.value);
    };

    // The picker panel is ~344px wide (8 columns). The left/right heuristic
    // above positions it relative to its wrapper — which sits inside the chat
    // input row — so on narrow viewports (standalone /chat on a phone) the
    // "left" branch can hang most of the panel off the right edge of the
    // screen. Clamp the resolved position to the visual viewport; must run
    // BEFORE animate() so the rect is measured at natural scale.
    const clampPickerToViewport = (el) => {
      // Undo any clamp from a previous open — the element survives via
      // v-show, and viewport size / orientation may have changed since.
      el.style.position = "";
      el.style.top = "";
      el.style.bottom = "";
      el.style.height = "";
      el.style.removeProperty("--num-columns");
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Fewer columns on very narrow screens so the panel itself fits.
      if (vw < 380) {
        el.style.setProperty("--num-columns", "6");
      }
      if (vh < 560) {
        el.style.height = `${Math.max(260, vh - 140)}px`;
      }
      let rect = el.getBoundingClientRect();
      if (rect.right > vw && rect.width <= vw) {
        el.style.left = "auto";
        el.style.right = "0px";
        rect = el.getBoundingClientRect();
      }
      if (rect.left < 0 || rect.right > vw) {
        // Still overflowing (wrapper anchored near a screen edge): escape the
        // wrapper's positioning context and pin to the viewport instead.
        el.style.position = "fixed";
        el.style.left = "8px";
        el.style.right = "auto";
        el.style.top = "auto";
        el.style.bottom = "64px";
      }
    };

    const pickerEnter = async (el, complete) => {
      await updateEmojiPickerPosition();
      el.addEventListener("emoji-click", handleEmoji);
      el.shadowRoot.querySelector("#search").placeholder = 'Hold "Shift" key to select multiple';

      // Apply positioning to the element
      Object.assign(el.style, emojiPickerStyle.value);
      clampPickerToViewport(el);

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
      behavior,
    };
  },
};
</script>

<template>
  <a-tooltip :title="dynamicTooltip">
    <div
      style="position: relative"
      class="has-tooltip-left"
      data-testid="chat-input"
      :data-chat-mode="behavior"
    >
      <ElasticInput
        v-if="!pickerOnly"
        v-bind="$attrs"
        :model-value="modelValue"
        :style="{
          'border-top-right-radius': '20px',
          'border-bottom-right-radius': '20px',
          'padding-right': '40px',
        }"
        :class="dynamicClass"
        @update:model-value="$emit('update:modelValue', $event)"
        @ref="(el) => (input = el)"
        @submit="$emit('submit')"
      />
      <div v-click-outside="() => (isPicking = false)" class="emoji-picker-wrapper">
        <button
          type="button"
          class="button is-right clickable is-rounded"
          :class="{
            'is-loading': loading,
            'is-primary': !className,
            [className]: true,
            'picker-only': pickerOnly,
          }"
          :disabled="loading"
          :style="style"
          @click="isPicking = !isPicking"
        >
          <slot name="icon">
            <span v-if="!loading" class="icon">
              <Icon size="48" src="emoji.svg" />
            </span>
          </slot>
        </button>
        <transition :css="false" @enter="pickerEnter" @leave="pickerLeave">
          <emoji-picker
            v-show="isPicking"
            ref="emojiPicker"
            :class="{ dark: chatDarkMode, light: !chatDarkMode }"
            :style="emojiPickerStyle"
          />
        </transition>
      </div>
    </div>
  </a-tooltip>
</template>

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
