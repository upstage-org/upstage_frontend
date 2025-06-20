<template>
  <button v-if="showClearChatSetting" class="chat-setting button is-rounded is-outlined" @click="handleClearChat"
    :class="{ 'is-loading': clearing }">
    <span class="icon">
      <Icon src="clear.svg" size="20" />
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import Icon from 'components/Icon.vue';
import { useChatStore } from 'store/modules/chat';

const props = defineProps<{
  option: string;
}>();

const route = useRoute();
const chatStore = useChatStore();

const showClearChatSetting = computed(() => chatStore.showClearChatSetting);
const clearing = computed(() => chatStore.clearing);

const handleClearChat = () => {
  chatStore.clearChat(route.params.url as string, props.option);
};
</script>

<style></style>
