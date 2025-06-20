<template>
  <div v-if="reactionVisibility" @click="showReactions(false)">
    <div class="icon is-large">
      <Icon src="clear.svg" size="36" />
    </div>
    <span class="tag is-light is-block">{{ $t("hide_reactions") }}</span>
  </div>
  <div v-else @click="showReactions(true)">
    <div class="icon is-large">
      <Icon src="change-nickname.svg" size="36" />
    </div>
    <span class="tag is-light is-block">{{ $t("show_reactions") }}</span>
  </div>
  <div v-if="chatVisibility" @click="showChat(false)">
    <div class="icon is-large">
      <Icon src="clear.svg" size="36" />
    </div>
    <span class="tag is-light is-block">{{ $t("hide_chat") }}</span>
  </div>
  <div v-else @click="showChat(true)">
    <div class="icon is-large">
      <Icon src="change-nickname.svg" size="36" />
    </div>
    <span class="tag is-light is-block">{{ $t("show_chat") }}</span>
  </div>
  <div @click="clearChat">
    <div class="icon is-large">
      <Icon src="erase.svg" size="36" />
    </div>
    <span class="tag is-light is-block">{{ $t("clear_chat") }}</span>
  </div>
  <div @click="toggleChatPosition">
    <div class="icon is-large">
      <Icon v-if="chatPosition === 'right'" src="right-chat.png" size="36" />
      <Icon v-else src="left-chat.png" size="36" />
    </div>
    <span class="tag is-light is-block">{{ $t("chat_position") }}</span>
  </div>
  <div>
    <div class="icon is-large">
      <ColorPicker v-model="backdropColor" @update:modelValue="sendBackdropColor" />
    </div>
    <span class="tag is-light is-block p-0 long-label">{{
      $t("background_colour")
    }}</span>
  </div>
  <div @click="masqueradeAudience">
    <div class="icon is-large">
      <Icon src="incognito.svg" size="36" />
    </div>
    <span class="tag is-light is-block">{{ $t("audience_view") }}</span>
  </div>
  <div v-if="chatDarkMode" @click="enableDarkModeChat(false)">
    <div class="icon is-large">
      <i class="fas fa-sun fa-2x has-text-warning"></i>
    </div>
    <span class="tag is-light is-block long-label">{{
      $t("light_mode_chat")
    }}</span>
  </div>
  <div v-else @click="enableDarkModeChat(true)">
    <div class="icon is-large">
      <i class="fas fa-moon fa-2x"></i>
    </div>
    <span class="tag is-light is-block long-label">{{
      $t("dark_mode_chat")
    }}</span>
  </div>
</template>

<script setup lang="ts">
import Icon from "components/Icon.vue";
import ColorPicker from "components/form/ColorPicker.vue";
import { useStageStore } from "../../../../store/modules/stage";
import { computed } from "vue";
import { message } from "ant-design-vue";

const store = useStageStore();

const chatVisibility = computed(() => store.settings.chatVisibility);
const chatDarkMode = computed(() => store.settings.chatDarkMode);
const reactionVisibility = computed(() => store.settings.reactionVisibility);
const backdropColor = computed(() => store.backdropColor);
const chatPosition = computed(() => store.chatPosition);

const showChat = (value: boolean) => {
  store.showChatBox(value);
};

const enableDarkModeChat = (value: boolean) => {
  store.enableDarkModeChat(value);
};

const showReactions = (value: boolean) => {
  store.showReactionsBar(value);
};

const clearChat = () => {
  store.clearChat();
  message.success("Chat cleared successfully!");
};

const sendBackdropColor = (color: string) => {
  store.setBackdropColor(color);
};

const toggleChatPosition = () => {
  store.setChatPosition(chatPosition.value === "left" ? "right" : "left");
};

const masqueradeAudience = () => {
  store.toggleMasquerading();
};
</script>

<style scoped>
.long-label {
  white-space: break-spaces;
  line-height: 1;
}
</style>
