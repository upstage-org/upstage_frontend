<script>
import { useStageStore } from "@stores/pinia/stage";
// Aliased: "Image" is a reserved HTML element name (vue/no-reserved-component-names).
import AppImage from "components/Image.vue";
import Icon from "components/Icon.vue";
import ContextMenu from "components/ContextMenu.vue";
import { coerceNumber } from "utils/common";
import { computed } from "vue";
import Skeleton from "../Skeleton.vue";

export default {
  components: { AppImage, Icon, ContextMenu, Skeleton },
  setup: () => {
    const stageStore = useStageStore();
    const curtains = stageStore.tools.curtains;

    // `stageStore.curtain` is now a `Curtain` object (or null). We
    // identify the active curtain by `src`, which is unique per asset.
    const currentCurtain = computed(() => stageStore.curtain ?? {});

    // Send the full curtain item (carrying `multi`, `frames`, `src`, name)
    // so audiences can animate multi-frame curtains the same way the
    // performer sees them.
    const toggleCurtain = (curtain) => {
      if (!curtain) {
        stageStore.drawCurtain(null);
        return;
      }
      if (curtain.src === currentCurtain.value.src) {
        stageStore.drawCurtain(null);
      } else {
        stageStore.drawCurtain({
          src: curtain.src,
          name: curtain.name,
          multi: curtain.multi,
          frames: curtain.frames,
        });
      }
    };

    const isActive = (curtain) => curtain.src === currentCurtain.value.src;

    const toggleAutoplay = () => {
      stageStore.toggleCurtainAutoplay();
    };

    const changeSpeed = (e) => {
      // Match `Backdrops.vue.changeBackdropSpeed`: `<input type="number">`
      // returns a raw string and Firefox does not round to `step`.
      const speed = coerceNumber(e.target.value, { min: 0, step: 0.5 });
      stageStore.setCurtainSpeed(speed ?? 0);
    };

    // Companion to changeSpeed: see Backdrops.vue.changeBackdropDwell
    // and the `Curtain.dwell` interface doc for the fade-vs-hold
    // model and why we keep them as separate parameters.
    const changeDwell = (e) => {
      const dwell = coerceNumber(e.target.value, { min: 0, step: 0.5 });
      stageStore.setCurtainDwell(dwell ?? 0);
    };

    const switchFrame = (frame) => {
      stageStore.setCurtainFrame(frame);
    };

    return {
      curtains,
      toggleCurtain,
      currentCurtain,
      isActive,
      toggleAutoplay,
      changeSpeed,
      changeDwell,
      switchFrame,
    };
  },
};
</script>

<template>
  <div @click="toggleCurtain(null)">
    <div class="icon is-large">
      <Icon size="36" src="clear.svg" />
    </div>
    <span class="tag is-light is-block">{{ $t("no_curtain") }}</span>
  </div>
  <ContextMenu
    v-for="curtain in curtains"
    :key="curtain.src"
    :title="curtain.name"
    :class="{
      active: isActive(curtain),
      flex: !(curtain.multi && isActive(curtain)),
    }"
  >
    <template #trigger>
      <Skeleton :data="curtain" nodrop>
        <AppImage :src="curtain.src" :title="curtain.name" @click="toggleCurtain(curtain)" />
        <template v-if="curtain.multi">
          <Icon class="is-multi" title="This is a multiframe curtain" src="multi-frame.svg" />
        </template>
      </Skeleton>
    </template>
    <template #context>
      <a v-if="!isActive(curtain)" class="panel-block px-4" @click="toggleCurtain(curtain)">
        <span class="panel-icon">
          <Icon src="backdrop.svg" />
        </span>
        <span>{{ $t("show_curtain") }}</span>
      </a>
      <a v-else class="panel-block px-4" @click="toggleCurtain(null)">
        <span class="panel-icon">
          <Icon src="clear.svg" />
        </span>
        <span>{{ $t("hide_curtain") }}</span>
      </a>
      <div
        v-if="curtain.multi && isActive(curtain) && curtain.frames"
        class="field has-addons menu-group"
      >
        <p class="control menu-group-item" @click="toggleAutoplay()">
          <button class="button is-light">
            <Icon :src="(currentCurtain.speed ?? 0) > 0 ? 'pause.svg' : 'play.svg'" size="24" />
          </button>
        </p>
        <p
          v-for="frame in curtain.frames"
          :key="frame"
          class="control menu-group-item"
          @click="switchFrame(frame)"
        >
          <button class="button is-light">
            <img :src="frame" style="height: 100%" />
          </button>
        </p>
      </div>
      <!--
        Two independent timing knobs for multi-frame curtains.
        Mirrors Backdrops.vue: see the comment there for the full
        rationale. `speed` is the fade duration (legacy field name
        kept for wire compatibility), `dwell` is the new hold
        duration that defaults to 0 to preserve pre-feature
        behaviour on existing media.
      -->
      <div
        v-if="curtain.multi && isActive(curtain)"
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
            :value="currentCurtain.speed ?? 0"
            placeholder="fade (s)"
            title="Crossfade duration between frames, in seconds"
            type="number"
            inputmode="decimal"
            @input="changeSpeed"
          />
        </p>
      </div>
      <div
        v-if="curtain.multi && isActive(curtain)"
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
            :value="currentCurtain.dwell ?? 0"
            placeholder="hold (s)"
            title="How long each frame stays fully visible before the next fade, in seconds"
            type="number"
            inputmode="decimal"
            @input="changeDwell"
          />
        </p>
      </div>
    </template>
  </ContextMenu>
</template>

<style scoped lang="scss">
.flex {
  display: flex;
}
</style>
