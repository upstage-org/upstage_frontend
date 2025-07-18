<template>
  <teleport to="body">
    <div
      class="avatar-topping"
      :style="{
        left: stageSize.left + object.x + object.w / 2 + 'px',
        top:
          stageSize.top + object.y - (object.holder && canPlay ? 30 : 0) + 'px',
      }"
      @click="openChatBox"
    >
      <a-tooltip
        :title="`${object.name ? object.name + ' held by' : 'Held by'} ${
          object.holder?.nickname
        }`"
      >
        <span
          v-if="object.holder && canPlay"
          class="icon marker"
          :class="{ inactive: !isHolding }"
        >
          <Icon src="my-avatar.svg" style="width: 16px; height: 16px" />
        </span>
      </a-tooltip>
      <transition @enter="enter" @leave="leave" :css="false" appear>
        <blockquote
          v-if="shouldShowBubble"
          class="bubble"
          tabindex="-1"
          :key="object.speak"
          :class="object.speak.behavior ?? 'speak'"
          :style="bubbleStyle"
        >
          <div class="py-2 px-4">
            <Linkify>{{ object.speak.message }}</Linkify>
          </div>
        </blockquote>
      </transition>
    </div>
  </teleport>
</template>

<script>
import { computed, ref, onMounted, onUnmounted } from "vue";
import { useStore } from "vuex";
import { animate } from "animejs";
import Icon from "components/Icon.vue";
import Linkify from "components/Linkify.vue";
import { outOfViewportPosition } from "utils/common";

export default {
  props: ["object", "active"],
  components: { Icon, Linkify },
  setup: (props) => {
    const store = useStore();
    const isHolding = computed(
      () => props.object.id === store.state.user.avatarId
    );
    const canPlay = computed(() => store.getters["stage/canPlay"]);

    const config = computed(() => store.getters["stage/config"]);

    const now = ref(Date.now());
    let timer = null;

    onMounted(() => {
      timer = setInterval(() => {
        now.value = Date.now();
      }, 1000);
    });

    onUnmounted(() => {
      if (timer) {
        clearInterval(timer);
      }
    });

    const enter = (el, complete) => {
      let pos = outOfViewportPosition(el);
      let count = 0;
      while (pos && count < 5) {
        if (pos === "top") {
          animate(el, {
            translateY: props.object.h + el.getBoundingClientRect().height,
            translateX: -props.object.h / 2,
            rotate: 180,
          });
          animate(el.firstElementChild, {
            rotate: 180,
          });
        }
        if (pos === "left") {
          animate(el, {
            translateX: -el.getBoundingClientRect().left - props.object.w / 2,
          });
        }
        if (pos === "right") {
          animate(el, {
            translateX:
              (window.innerWidth || document.documentElement.clientWidth) -
              el.getBoundingClientRect().right,
          });
        }
        pos = outOfViewportPosition(el);
        count++;
      }
      const duration = config.value?.animations?.bubbleSpeed ?? 1000;
      console.log(config.value?.animations?.bubbleSpeed);
      switch (config.value?.animations?.bubble) {
        case "fade":
          animate(el, {
            opacity: [0, 1],
            duration,
            onComplete: complete,
          });
          break;

        case "bounce":
          animate(el, {
            scale: [0, 1],
            rotate: [180, 0],
            translateX: [0, "-50%"],
            duration,
            onComplete: complete,
          });
          break;

        default:
          complete();
          break;
      }
    };

    const leave = (el, complete) => {
      const duration = config.value?.animations?.bubbleSpeed ?? 1000;
      switch (config.value?.animations?.bubble) {
        case "fade":
          animate(el, {
            opacity: 0,
            duration,
            onComplete: complete,
          });
          break;

        case "bounce":
          animate(el, {
            scale: [1, 0],
            rotate: [0, 180],
            duration,
            onComplete: complete,
          });
          break;

        default:
          complete();
          break;
      }
    };

    const openChatBox = () => {
      if (isHolding.value) {
        store.dispatch("stage/openSettingPopup", {
          type: "ChatBox",
          simple: true,
        });
      }
    };
    const stageSize = computed(() => store.getters["stage/stageSize"]);
    const bubbleStyle = computed(() => {
      if (!props.object.speak?.message) {
        return {};
      }
      let length = props.object.speak.message.length;
      if (length < 5) {
        length = 5;
      }
      if (["shout"].includes(props.object.speak.behavior)) {
        length *= 1.4;
      }
      const width = Math.sqrt(length * 2.5);
      const height = Math.max(2.5, width * 0.8);
      return { width: width + "rem", height: height + "rem" };
    });

    const shouldShowBubble = computed(() => {
      if (!props.object.speak?.message) return false;

      const BUBBLE_TIMEOUT = 5000;
      const currentTime = now.value;
      const speechTime = props.object.speak.at;

      return currentTime - speechTime < BUBBLE_TIMEOUT;
    });

    return {
      enter,
      leave,
      isHolding,
      canPlay,
      openChatBox,
      stageSize,
      max: Math.max,
      bubbleStyle,
      shouldShowBubble,
    };
  },
};
</script>

<style scoped lang="scss">
.avatar-topping {
  position: fixed;
  z-index: 3000;
}

.marker {
  position: absolute;
  left: -12px;
}

.inactive {
  filter: grayscale(1);
}
</style>
