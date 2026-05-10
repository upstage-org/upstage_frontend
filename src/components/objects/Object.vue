<template>
  <!--
    Identity attributes (data-testid, data-object-id, data-object-type), keyboard
    focus (tabindex), and primary pointer handlers live on the `.object` div
    inside <Moveable>'s slot. That div fills 100% of Moveable's wrapper, which
    is sized to object.w × object.h, so it's a real, visible, interactive
    target.

    Previously these attributes lived on an outer wrapper around <ContextMenu>,
    but that wrapper had no intrinsic size: both of its visible children
    (the overlay-UI div and <Moveable>) are position: absolute, so the wrapper
    collapsed to 0×0. That made:
      - Playwright `[data-testid="object-*"]` lookups not "visible"
      - `tabindex="0"` focusable but with no focus ring / hit area
    Moving them onto the sized `.object` div fixes both without changing the
    pointer event path (clicks on the visible asset already bubble to .object).
  -->
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
        <div
          ref="el"
          tabindex="0"
          :data-testid="object?.name ? `object-${object.name}` : undefined"
          :data-object-id="object?.id"
          :data-object-type="object?.type"
          class="object"
          :class="{ 'link-hover-effect': hasLink && object.link.effect }"
          :style="{
            width: '100%',
            height: '100%',
            cursor: controlable
              ? 'grab'
              : object.link && object.link.url
                ? 'pointer'
                : 'normal',
            ...(activeMovable ? { position: 'relative', 'z-index': 1 } : {}),
          }"
          @keyup.delete="deleteObject"
          @dblclick="hold"
          @click="openLink"
          @dragstart.prevent
        >
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
