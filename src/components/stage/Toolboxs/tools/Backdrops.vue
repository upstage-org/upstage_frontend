<script>
import { useStageStore } from "@stores/pinia/stage";
import { computed } from "vue";
// Aliased: "Image" is a reserved HTML element name (vue/no-reserved-component-names).
import AppImage from "components/Image.vue";
import Icon from "components/Icon.vue";
import ContextMenu from "components/ContextMenu.vue";
import { coerceNumber, throttle } from "utils/common";
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
      // `<input type="number">` returns a raw string and Firefox does not
      // round to `step`; coerce to a number with the input's constraints.
      const speed = coerceNumber(e.target.value, { min: 0, step: 0.5 });
      stageStore.setBackground({
        ...currentBackground.value,
        speed: speed ?? 0,
      });
    };

    // Companion to changeBackdropSpeed: dwell (hold) is independent of
    // fade. See the `Background.dwell` interface doc for the model.
    const changeBackdropDwell = (e) => {
      const dwell = coerceNumber(e.target.value, { min: 0, step: 0.5 });
      stageStore.setBackground({
        ...currentBackground.value,
        dwell: dwell ?? 0,
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
      changeBackdropDwell,
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
      <!--
        Two independent timing knobs for multi-frame backdrops:
          * fade  – seconds each crossfade takes (also the legacy
                    `speed` field; kept under that name on the wire
                    for backward compatibility).
          * hold  – seconds each frame stays at full opacity between
                    fades. `dwell` on the wire. Defaults to 0 so
                    media without an explicit hold value animates
                    exactly as it did pre-feature.
        Same icon for both rows (animation-slider.svg) — the
        `placeholder` on each input is what disambiguates them at a
        glance, and the `title` tooltip carries the full explanation
        for keyboard / hover users.
      -->
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
            placeholder="fade (s)"
            title="Crossfade duration between frames, in seconds"
            type="number"
            inputmode="decimal"
            @input="changeBackdropSpeed"
          />
        </p>
      </div>
      <div
        v-if="background.id === currentBackground.id && background.multi"
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
            :value="currentBackground.dwell ?? 0"
            placeholder="hold (s)"
            title="How long each frame stays fully visible before the next fade, in seconds"
            type="number"
            inputmode="decimal"
            @input="changeBackdropDwell"
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
