<script>
import { computed, watch } from "vue";
import { useStore } from "vuex";
import { animate } from "animejs";
import ChatInput from "components/form/ChatInput.vue";
import Icon from "components/Icon.vue";
import { useUserStore } from "@stores/pinia/user";

export default {
  components: { ChatInput, Icon },
  props: { customEmoji: Object },
  setup: () => {
    const store = useStore();
    const userStore = useUserStore();
    const reactionVisibility = computed(() => store.state.stage.settings.reactionVisibility);
    watch(reactionVisibility, console.log);
    const nickname = computed(() => {
      const n = userStore.nickname;
      if (n.length > 15) {
        return n.slice(0, 10) + "...";
      }
      return n;
    });

    const reactions = ["❤️", "🤣", "🙌", "👏"];
    const sendReaction = (react) => {
      store.dispatch("stage/sendReaction", react);
    };

    const flyingReactions = computed(() => store.state.stage.reactions);

    const flyin = (el) => {
      animate(el, {
        translateY: [100, 0],
        scale: [1, 1.5, 1],
        ease: "outExpo",
        duration: 800,
      });
    };
    const flyout = (el, complete) => {
      animate(el, {
        scale: 0,
        rotate: 180,
        translateY: 100,
        ease: "outBounce",
        duration: 800,
        onComplete: complete,
      });
    };

    const sendCustomReaction = (e) => {
      sendReaction(e);
    };

    const openChatSetting = () =>
      store.dispatch("stage/openSettingPopup", {
        type: "ChatParameters",
      });

    return {
      reactions,
      sendReaction,
      flyingReactions,
      flyin,
      flyout,
      sendCustomReaction,
      reactionVisibility,
      nickname,
      openChatSetting,
    };
  },
};
</script>

<template>
  <template v-if="reactionVisibility">
    <button
      v-for="react in reactions"
      :key="react"
      class="button is-small is-rounded reaction mx-1"
      style="width: 26px; height: 26px; padding: 0px"
      @click="sendReaction(react)"
    >
      {{ react }}
    </button>
    <span v-if="customEmoji" style="position: absolute; margin-left: 28px">
      <ChatInput
        :picker-only="true"
        :style="{ height: '24px', padding: 0 }"
        class-name="is-white"
        @update:model-value="sendCustomReaction"
      >
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
          <div
            v-for="react in flyingReactions"
            :key="react"
            :style="{
              position: 'fixed',
              left: react.x + 'px',
              top: react.y + 'px',
              fontSize: '42px',
            }"
          >
            {{ react.reaction }}
          </div>
        </transition-group>
      </div>
    </teleport>
  </template>
  <div v-else class="my-1" style="float: left">
    Your nickname is:
    <a @click="openChatSetting">{{ nickname }}</a>
  </div>
</template>

<style lang="scss" scoped>
.flying-reactions {
  position: fixed;
}

.button.is-rounded {
  width: 16px;
}
</style>
