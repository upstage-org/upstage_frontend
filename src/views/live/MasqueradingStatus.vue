<script setup lang="ts">
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import Icon from "components/Icon.vue";

const stageStore = useStageStore();
const masquerading = computed<boolean>(() => stageStore.masquerading);
const exitAudienceView = () => {
  stageStore.TOGGLE_MASQUERADING();
};
</script>

<template>
  <a-tooltip
    v-if="masquerading"
    title="You are masquerading as audience. Click to go back to the player mode!"
  >
    <div
      id="masquerading-status"
      class="clickable has-tooltip-left"
      role="button"
      tabindex="0"
      aria-label="Exit audience view"
      @click="exitAudienceView"
      @keydown.enter.prevent="exitAudienceView"
      @keydown.space.prevent="exitAudienceView"
    >
      <Icon src="incognito.svg" :size="28" />
    </div>
  </a-tooltip>
</template>

<style scoped lang="scss">
/*
 * The incognito glyph is a single dark colour, so it disappears
 * against any dark backdrop / curtain (the live stage often has
 * black or near-black backgrounds). Wrap it in a high-contrast
 * pill so the masquerade indicator is visible regardless of what
 * the stage looks like behind it. The wrapper also gives the
 * click/tap target a clear visual affordance that it's a button.
 */
#masquerading-status {
  flex: 0 0 auto;
  line-height: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background-color: rgba(255, 255, 255, 0.95);
  border: 2px solid #1a1a1a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  transition:
    background-color 0.15s ease,
    transform 0.15s ease,
    box-shadow 0.15s ease;

  &:hover,
  &:focus-visible {
    background-color: #ffffff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
    transform: scale(1.05);
    outline: none;
  }

  &:active {
    transform: scale(0.97);
  }
}
</style>
