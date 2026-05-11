<script>
import { useStageStore } from "@stores/pinia/stage";
import { computed } from "vue";
// Aliased: "Image" is a reserved HTML element name (vue/no-reserved-component-names).
import AppImage from "components/Image.vue";
import Icon from "components/Icon.vue";
import ContextMenu from "components/ContextMenu.vue";
import { throttle } from "utils/common";
import Skeleton from "../Skeleton.vue";

export default {
  components: { AppImage, Icon, ContextMenu, Skeleton },
  setup: () => {
    const stageStore = useStageStore();
    const currentBackground = computed(() => stageStore.background ?? {});

    const backgrounds = computed(() => stageStore.tools.backdrops);

    const setBackground = (background) => {
      stageStore.setBackground(background);
    };

    const changeBackdropSpeed = (e) => {
      stageStore.setBackground({
        ...currentBackground.value,
        speed: e.target.value,
      });
    };

    const toggleAutoplayFrames = () => {
      let speed = 0;
      if (!currentBackground.value.speed) {
        speed = currentBackground.value.lastSpeed ?? 0.5;
      }
      stageStore.setBackground({
        ...currentBackground.value,
        lastSpeed: currentBackground.value.speed,
        speed,
      });
    };

    const switchBackdropFrame = (currentFrame) => {
      stageStore.setBackground({
        ...currentBackground.value,
        currentFrame,
      });
    };

    const setBackgroundThrottled = throttle(setBackground, 100);

    const adjustOpacity = (background, opacity, shouldThrottle) => {
      background.opacity = opacity;
      if (background.id === currentBackground.value.id) {
        const f = shouldThrottle ? setBackgroundThrottled : setBackground;
        f({
          ...currentBackground.value,
          opacity,
        });
      }
    };

    const opacity = (background) => {
      if (background.id === currentBackground.value.id) {
        background.opacity = currentBackground.value.opacity;
      }
      if (background.opacity) {
        return background.opacity;
      }
      return 1;
    };

    return {
      backgrounds,
      setBackground,
      currentBackground,
      changeBackdropSpeed,
      toggleAutoplayFrames,
      switchBackdropFrame,
      adjustOpacity,
      opacity,
    };
  },
};
</script>

<template>
  <div @click="setBackground({ src: null })">
    <div class="icon is-large">
      <Icon size="36" src="clear.svg" />
    </div>
    <span class="tag is-light is-block">{{ $t("clear") }}</span>
  </div>
  <ContextMenu
    v-for="background in backgrounds"
    :key="background"
    :title="background.name"
    :class="{
      active: background.id === currentBackground.id,
      flex: !(background.multi && background.id === currentBackground.id),
    }"
  >
    <template #trigger>
      <Skeleton :data="background" nodrop>
        <AppImage :src="background.src" @click="setBackground(background)" />
        <template v-if="background.multi">
          <Icon class="is-multi" title="This is a multiframe backdrop" src="multi-frame.svg" />
        </template>
      </Skeleton>
    </template>
    <template #context>
      <a
        v-if="background.id !== currentBackground.id"
        class="panel-block px-4"
        @click="setBackground(background)"
      >
        <span class="panel-icon">
          <Icon src="backdrop.svg" />
        </span>
        <span>{{ $t("set_as_backdrop") }}</span>
      </a>
      <div
        v-if="background.multi && background.id === currentBackground.id"
        class="field has-addons menu-group"
      >
        <p class="control menu-group-item" @click="toggleAutoplayFrames()">
          <button class="button is-light">
            <Icon :src="currentBackground.speed > 0 ? 'pause.svg' : 'play.svg'" size="24" />
          </button>
        </p>
        <p
          v-for="frame in background.frames"
          :key="frame"
          class="control menu-group-item"
          @click="switchBackdropFrame(frame)"
        >
          <button class="button is-light">
            <img :src="frame" style="height: 100%" />
          </button>
        </p>
      </div>
      <div
        v-if="background.id === currentBackground.id"
        class="field has-addons menu-group px-4 my-2"
      >
        <p class="control menu-group-title">
          <span class="panel-icon pt-1">
            <Icon src="animation-slider.svg" />
          </span>
        </p>
        <p class="control menu-group-item is-fullwidth">
          <input
            class="slider is-fullwidth is-primary mt-0"
            step="0.5"
            min="0"
            :value="currentBackground.speed"
            placeholder="seconds"
            type="number"
            @input="changeBackdropSpeed"
          />
        </p>
      </div>
      <div class="field has-addons menu-group px-4 my-2">
        <p class="control menu-group-title">
          <span class="panel-icon pt-1">
            <Icon src="opacity-slider.svg" />
          </span>
        </p>
        <p class="control menu-group-item is-fullwidth">
          <input
            class="slider is-fullwidth is-primary my-0"
            step="0.01"
            min="0"
            max="1"
            :value="opacity(background)"
            type="range"
            @input="adjustOpacity(background, $event.target.value, true)"
            @change="adjustOpacity(background, $event.target.value, false)"
          />
        </p>
      </div>
    </template>
  </ContextMenu>
</template>

<style scoped>
.flex {
  display: flex;
}
</style>
