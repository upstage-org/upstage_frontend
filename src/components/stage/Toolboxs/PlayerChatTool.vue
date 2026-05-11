<script>
import Icon from "components/Icon.vue";
import { useStore } from "vuex";
import { computed } from "vue";
export default {
  components: { Icon },
  setup: () => {
    const store = useStore();
    const showPlayerChat = computed(() => store.state.stage.showPlayerChat);
    const togglePlayerChat = () => {
      store.dispatch("stage/showPlayerChat", !showPlayerChat.value);
    };
    const unread = computed(() => store.getters["stage/unreadPrivateMessageCount"]);

    return { showPlayerChat, togglePlayerChat, unread };
  },
};
</script>

<template>
  <a-tooltip placement="rightBottom">
    <template #title>Player Chat</template>
    <a
      :class="{ 'is-active': showPlayerChat }"
      class="panel-block button"
      @click="togglePlayerChat"
    >
      <span class="panel-icon">
        <Icon src="chat.svg" />
        <span v-if="unread" class="unread tag is-danger is-small">{{ unread }}</span>
      </span>
    </a>
  </a-tooltip>
</template>

<style scoped>
.unread {
  position: relative;
  top: -16px;
}
</style>
