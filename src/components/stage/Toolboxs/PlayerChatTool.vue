<template>
  <a-tooltip placement="rightBottom">
    <template #title>Player Chat</template>
    <a @click="togglePlayerChat" :class="{ 'is-active': showPlayerChat }" class="panel-block button">
      <span class="panel-icon">
        <Icon src="chat.svg" />
        <span v-if="unread" class="unread tag is-danger is-small">{{
          unread
          }}</span>
      </span>
    </a>
  </a-tooltip>
</template>

<script setup lang="ts">
import Icon from "components/Icon.vue";
import { useStageStore } from 'store';
import { storeToRefs } from 'pinia';

const stageStore = useStageStore();
const { showPlayerChat, unreadPrivateMessageCount: unread } = storeToRefs(stageStore);

const togglePlayerChat = () => {
  stageStore.showPlayerChat(!showPlayerChat.value);
};
</script>

<style scoped>
.unread {
  position: relative;
  top: -16px;
}
</style>
