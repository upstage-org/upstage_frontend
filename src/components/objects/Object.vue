<template>
  <div ref="el" tabindex="0" @keyup.delete="deleteObject" @dblclick="hold" @click="openLink" :style="activeMovable
    ? {
      position: 'relative',
      'z-index': 1,
    }
    : {}
    ">
    <ContextMenu :pad-left="-stageSize.left" :pad-top="-stageSize.top" :pad-right="250" :opacity="0.8">
      <template #trigger>
        <div :style="{
          position: 'absolute',
          left: object.x + 'px',
          top: object.y + 'px',
          width: object.w + 'px',
          height: object.h + 'px',
          transform: `rotate(${object.rotate}deg)`,
        }">
          <OpacitySlider v-model:active="active" v-model:slider-mode="sliderMode" :object="object" />
          <QuickAction :object="object" v-model:active="active" />
          <Topping :object="object" v-model:active="active" />
        </div>
        <Moveable v-model:active="active" :controlable="controlable" :object="object">
          <div class="object" :class="{ 'link-hover-effect': hasLink && object.link.effect }" :style="{
            width: '100%',
            height: '100%',
            cursor: controlable
              ? 'grab'
              : object.link && object.link.url
                ? 'pointer'
                : 'normal',
          }" @dragstart.prevent>
            <slot name="render">
              <video v-if="object.assetType?.name == 'video'" class="the-object-video" :src="object.url" ref="video"
                preload="auto" @ended="object.isPlaying = false" :loop="object.loop"
                @loadeddata="loadeddata"
                v-bind:id="'video' + object.id"
                ></video>
              <Image v-else class="the-object" :src="src" />
            </slot>
          </div>
        </Moveable>
      </template>
      <template #context="slotProps">
        <div v-if="isWearing || controlable">
          <slot name="menu" v-bind="slotProps" :slider-mode="sliderMode"
            :set-slider-mode="(mode) => (sliderMode = mode)" :keep-active="() => (active = true)" />
        </div>
      </template>
    </ContextMenu>
  </div>
</template>

<script>
import { useStore } from "vuex";
import { computed, provide, reactive, ref, watch } from "vue";
import Image from "components/Image.vue";
import ContextMenu from "components/ContextMenu.vue";
import OpacitySlider from "./OpacitySlider.vue";
import QuickAction from "./QuickAction.vue";
import Topping from "./Topping.vue";
import Moveable from "./Moveable.vue";

export default {
  props: ["object"],
  emits: ["dblclick"],
  components: {
    Image,
    ContextMenu,
    OpacitySlider,
    QuickAction,
    Topping,
    Moveable,
  },
  setup(props) {
    // Dom refs
    const el = ref();
    const video = ref();
    // Vuex store
    const store = useStore();
    const stageSize = computed(() => store.getters["stage/stageSize"]);

    // Local state
    const active = ref(false);
    const sliderMode = ref("opacity");
    const beforeDragPosition = ref();
    const isHolding = computed(
      () => props.object.holder?.id === store.state.stage.session,
    );
    const holdable = computed(() => ["avatar"].includes(props.object.type));
    const canPlay = computed(() => store.getters["stage/canPlay"]);
    const controlable = computed(() => {
      return holdable.value
        ? isHolding.value
        : canPlay.value && !props.object.wornBy;
    });
    provide("holdable", holdable);

    const deleteObject = () => {
      if (controlable.value) {
        //store.dispatch("stage/deleteObject", props.object);
      }
    };

    const frameAnimation = reactive({
      interval: null,
      currentFrame: null,
    });
    if (props.object.multi) {
      watch(
        () => props.object.autoplayFrames,
        () => {
          const { autoplayFrames, frames, src } = props.object;
          clearInterval(frameAnimation.interval);
          if (autoplayFrames) {
            frameAnimation.currentFrame = src;
            frameAnimation.interval = setInterval(() => {
              let nextFrame = frames.indexOf(frameAnimation.currentFrame) + 1;
              if (nextFrame >= frames.length) {
                nextFrame = 0;
              }
              frameAnimation.currentFrame = frames[nextFrame];
            }, parseFloat(autoplayFrames) * 1000);
          }
        },
        {
          immediate: true,
        },
      );
    }
    const src = computed(() => {
      if (props.object.autoplayFrames && props.object.multi) {
        return frameAnimation.currentFrame;
      } else {
        return props.object.src;
      }
    });

    const hold = () => {
      if (holdable.value && canPlay.value && !props.object.holder) {
        store.dispatch("user/setAvatarId", props.object.id);
      }
    };
    const activeMovable = computed(
      () => store.getters["stage/activeMovable"] === props.object.id,
    );

    const isWearing = computed(
      () =>
        props.object.wornBy &&
        store.getters["stage/currentAvatar"]?.id === props.object.wornBy,
    );
    provide("isWearing", isWearing);

    const hasLink = computed(
      () => !canPlay.value && props.object.link && props.object.link.url,
    );
    const openLink = () => {
      if (hasLink.value) {
        const { url, blank } = props.object.link;
        window.open(url, blank ? "_blank" : "_self").focus();
      }
    };

    const synchronize = () => {
      if (props.object.isPlaying && video.value) {
        video.value.play();
      } else {
        video.value && video.value.pause();
      }
    };
    watch(
      () => props.object,
      () => {
        synchronize();
      },
    );
    watch(
      () => props.object.replayed,
      () => {
        video.value.currentTime = 0;
      },
    );
    const loadeddata = () => {
      synchronize();
    };
    return {
      el,
      print,
      active,
      beforeDragPosition,
      deleteObject,
      src,
      stageSize,
      hold,
      isHolding,
      holdable,
      controlable,
      sliderMode,
      activeMovable,
      isWearing,
      hasLink,
      openLink,
      loadeddata,
      video
    };
  },
};
</script>

<style lang="scss">
div[tabindex] {
  outline: none;
}

.object {
  z-index: 10;

  &.link-hover-effect {
    transition: transform v-bind(transition);
  }

  &.link-hover-effect:hover {
    transform: scale(1.2) !important;
  }
}

.the-object-video {
  width: 100%;
  height: 100%;
}
</style>
