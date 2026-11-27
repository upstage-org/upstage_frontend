<script>
import dayjs from "@utils/dayjs";
import Linkify from "components/Linkify.vue";
import Divider from "components/Divider.vue";
import ContextMenu from "components/ContextMenu.vue";
import Icon from "components/Icon.vue";
import { useStageStore } from "@stores/pinia/stage";
import { computed, inject } from "vue";
import { chatClockTime, chatLogStamp } from "./chatLog";

export default {
  components: { Linkify, Divider, ContextMenu, Icon },
  props: {
    messages: Array,
    style: [String, Object],
    // Empty-list wording (#1581). True where the viewer can type — the live
    // public chat — and the list greets them and points at the field below.
    // Everywhere else the same component lists messages with no field under
    // it (a replay, an archived transcript in Stage Management), so the
    // default is the neutral "No messages yet!".
    welcome: Boolean,
    // Timestamps (#1567). Left alone, the viewer's own on-stage setting
    // decides and each line gets a clock time. A list shown away from the
    // stage — the archived transcript in Stage Management — makes its own
    // choice (`showTimes` true/false) and asks for the full date and time
    // (`fullTimes`), since its lines can be months old.
    showTimes: { type: Boolean, default: undefined },
    fullTimes: Boolean,
  },
  setup: (props) => {
    const isChatStandalone = inject("isChatStandalone", false);
    const replaying = inject("replaying", false);
    const stageStore = useStageStore();
    const messageClass = {
      think: "has-text-info has-background-info-light",
      shout: "has-text-danger",
      highlighted: "has-background-warning",
    };
    // Replay-aware like Chat/index.vue: remove/highlight are moderation
    // actions that broadcast to the LIVE stage over MQTT, so they must not
    // be reachable from inside a recording.
    const canPlay = computed(() => stageStore.canPlay && !replaying);
    const session = computed(() => stageStore.session);

    const time = (value) => {
      return dayjs(value).fromNow();
    };
    // Per-viewer switch in the chat settings (Parameters tab), #1567.
    const showTimestamps = computed(
      () => props.showTimes ?? Boolean(stageStore.chat.showTimestamps),
    );
    const clock = (value) => (props.fullTimes ? chatLogStamp(value) : chatClockTime(value));
    // "Clear chat" dividers carry their time too in the full (archive) form,
    // as they do in the downloaded log.
    const clearedAt = (item) => {
      const stamp = showTimestamps.value && props.fullTimes ? chatLogStamp(item.at) : "";
      return stamp ? ` (${stamp})` : "";
    };

    // `removeChat` / `highlightChat` are synchronous in Pinia (the
    // mqtt.sendMessage call is not awaited inside the action). The
    // previous `.then(closeMenu)` chained onto Vuex's dispatch result
    // ran on the next microtask; running the callback inline is
    // equivalent.
    const removeChat = (item, closeMenu) => {
      stageStore.removeChat(item.id);
      closeMenu();
    };

    const highlightChat = (item, closeMenu) => {
      if (canPlay.value) {
        stageStore.highlightChat(item.id);
        closeMenu();
      }
    };

    return {
      messageClass,
      time,
      removeChat,
      highlightChat,
      canPlay,
      session,
      isChatStandalone,
      replaying,
      showTimestamps,
      clock,
      clearedAt,
    };
  },
};
</script>

<template>
  <div
    v-if="!messages.length"
    class="columns is-vcentered chat-empty"
    :class="{ 'is-fullheight': !isChatStandalone, 'chat-empty-standalone': isChatStandalone }"
    data-testid="chat-empty"
  >
    <div class="column has-text-centered">
      <i class="fas fa-comments fa-4x chat-empty-icon"></i>
      <template v-if="welcome">
        <p class="chat-empty-title">{{ $t("chat_welcome_title") }}</p>
        <p class="chat-empty-hint">{{ $t("chat_welcome_hint") }}</p>
      </template>
      <p v-else class="chat-empty-title">{{ $t("chat_no_messages") }}</p>
    </div>
  </div>
  <div v-else>
    <p v-for="item in messages" :key="item" :class="{ guest: !item.isPlayer }">
      <template v-if="item.clear">
        <Divider>{{ $t("clear_chat") }}{{ clearedAt(item) }}</Divider>
      </template>
      <template v-else-if="item.clearPlayerChat">
        <Divider>{{ $t("clear_chat") }}{{ clearedAt(item) }}</Divider>
      </template>
      <template v-else>
        <ContextMenu>
          <template #trigger>
            <div class="chat-line">
              <small
                v-if="showTimestamps && clock(item.at)"
                class="chat-line-time"
                data-testid="chat-time"
                :title="time(item.at)"
                >{{ clock(item.at) }}</small
              >
              <small class="chat-line-author">
                <b v-if="item.isPlayer">{{ item.user }}:</b>
                <span v-else>{{ item.user }}:</span>
              </small>
              <span
                class="tag message"
                :style="{
                  'font-size': '1em',
                }"
                :class="messageClass[item.highlighted ? 'highlighted' : item.behavior]"
                :title="time(item.at)"
              >
                <a-tooltip
                  :title="canPlay ? 'Click to remove highlight' : 'This is a highlight message'"
                >
                  <span
                    v-if="item.highlighted"
                    class="highlight-star has-tooltip-left"
                    @click="highlightChat(item)"
                  >
                    <i class="far fa-star has-text-warning"></i>
                  </span>
                </a-tooltip>
                <Linkify>{{ item.message }}</Linkify>
              </span>
            </div>
          </template>
          <!-- "own message" delete is also live-only: no actions in a recording. -->
          <template
            v-if="canPlay || (!replaying && session === item.session)"
            #context="{ closeMenu }"
          >
            <div class="panel-block">
              <span>
                <Linkify>{{ item.message }}</Linkify>
                <div>
                  <small class="has-text-dark">
                    Sent by
                    <span v-if="session === item.session">{{ $t("you") }}</span>
                    <span v-else>{{ item.user }}</span>
                    {{ time(item.at) }}
                  </small>
                </div>
              </span>
            </div>
            <template v-if="item.id">
              <a class="panel-block has-text-danger" @click="removeChat(item, closeMenu)">
                <span class="panel-icon">
                  <Icon src="remove.svg" />
                </span>
                <span>{{ $t("remove") }}</span>
              </a>
              <template v-if="canPlay">
                <a
                  v-if="item.highlighted"
                  class="panel-block"
                  @click="highlightChat(item, closeMenu)"
                >
                  <span class="panel-icon">
                    <Icon src="object-drawing.svg" />
                  </span>
                  <span>{{ $t("unhighlight") }}</span>
                </a>
                <a
                  v-else
                  class="panel-block has-text-primary"
                  @click="highlightChat(item, closeMenu)"
                >
                  <span class="panel-icon">
                    <Icon src="object-drawing.svg" />
                  </span>
                  <span>{{ $t("highlight") }}</span>
                </a>
              </template>
            </template>
            <div v-else class="panel-block has-text-dark">
              <span class="panel-icon">
                <Icon src="clear.svg" />
              </span>
              <small>Sorry but no actions can be performed against these legacy messages!</small>
            </div>
          </template>
        </ContextMenu>
      </template>
    </p>
  </div>
</template>

<style lang="scss">
.chat-line {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chat-line-author {
  font-size: 1em;
  line-height: 1;
}

.chat-line-time {
  font-size: 0.8em;
  line-height: 1;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.tag.message {
  white-space: break-spaces;
  height: unset;
  line-height: 1.25;

  .highlight-star {
    position: absolute;
    right: -16px;
  }
}

.guest {
  opacity: 0.8;
}

/* Empty list (#1581). No colour of its own: it takes the colour of whatever
   it sits in, exactly like the chat lines do — dark text on the light chat,
   white on the dark chat, dark in the Stage Management transcript window.
   It used to be fixed near-white, which only showed up on the dark chat. */
.chat-empty {
  color: inherit;

  .chat-empty-icon {
    opacity: 0.6;
  }

  /* Margins spelled out in full: the global paragraph reset adds 1em under
     every <p>, which pushed the two lines apart as if they were unrelated. */
  .chat-empty-title {
    margin: 0.5rem 0 0;
    font-size: 1.25rem;
    line-height: 1.25;
  }

  .chat-empty-hint {
    margin: 0.3rem 0 0;
    font-size: 1rem;
    line-height: 1.3;
  }
}

/* Avoid stretching to the full scroll viewport in /chat/:url — that defeats
   bottom-anchoring of the message list near the composer on mobile. */
.chat-empty-standalone {
  flex-grow: 0 !important;
  min-height: 0 !important;
  padding-bottom: 0.5rem;
}
</style>
