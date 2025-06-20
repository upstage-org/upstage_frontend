<template>
  <template v-if="reactionVisibility">
    <button class="button is-small is-rounded reaction mx-1" v-for="react in reactions" :key="react"
      @click="sendReaction(react)" style="width: 26px; height: 26px; padding: 0px;">
      {{ react }}
    </button>
    <span v-if="customEmoji" style="position: absolute; margin-left: 28px">
      <ChatInput :picker-only="true" :style="{ height: '24px', padding: 0 }" className="is-white"
        @update:model-value="sendCustomReaction">
        <template #icon>
          <a-tooltip title="Custom Reactions">
            <span class="icon">
              <Icon src="new.svg" />
            </span>
          </a-tooltip>
        </template>
      </ChatInput>
    </span>
    <teleport to="body">
      <div class="flying-reactions">
        <transition-group :css="false" @enter="flyin" @leave="flyout">
          <div v-for="react in flyingReactions" :key="react" :style="{
            position: 'fixed',
            left: react.x + 'px',
            top: react.y + 'px',
            fontSize: '42px',
          }">
            {{ react.reaction }}
          </div>
        </transition-group>
      </div>
    </teleport>
  </template>
  <div class="my-1" style="float: left" v-else>
    Your nickname is:
    <a @click="openChatSetting">{{ nickname }}</a>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { animate } from "animejs";
import { useReactionsStore } from "store/reactions";
import { useUserStore } from "store";
import ChatInput from "components/form/ChatInput.vue";
import Icon from "components/Icon.vue";

const props = defineProps<{
  customEmoji?: boolean;
}>();

const reactionsStore = useReactionsStore();
const userStore = useUserStore();

const reactionVisibility = computed(() => reactionsStore.settings.reactionVisibility);
const nickname = computed(() => {
  const nickname = userStore.nickname;
  if (nickname.length > 15) {
    return nickname.slice(0, 10) + "...";
  }
  return nickname;
});

const reactions = ["❤️", "🤣", "🙌", "👏"];
const flyingReactions = computed(() => reactionsStore.reactions);

const sendReaction = (react: string) => {
  reactionsStore.sendReaction(react);
};

const flyin = (el: Element) => {
  animate(el, {
    translateY: [100, 0],
    scale: [1, 1.5, 1],
    ease: 'outExpo',
    duration: 800
  });
};

const flyout = (el: Element, complete: () => void) => {
  animate(el, {
    scale: 0,
    rotate: 180,
    translateY: 100,
    ease: 'outBounce',
    duration: 800,
    onComplete: complete,
  });
};

const sendCustomReaction = (e: string) => {
  sendReaction(e);
};

const openChatSetting = () => {
  // TODO: Implement chat settings popup
  console.log('Open chat settings');
};
</script>

<style lang="scss" scoped>
.flying-reactions {
  position: fixed;
}

.button.is-rounded {
  width: 16px;
}
</style>
