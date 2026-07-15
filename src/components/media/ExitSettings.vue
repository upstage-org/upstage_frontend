<!--
  Exit (removal) animation picker for one stage assignment: how this media
  leaves that particular stage. Used inline per assigned stage in the media
  form's Stages tab and per media row in Stage Management > Media.

  There is no "stage default" sentinel: every assignment has a concrete
  type, "vanish" (Disappear) unless chosen otherwise. The speed slider is
  disabled for "vanish" since an instant exit has no duration.
-->
<script lang="ts" setup>
import { computed, ref } from "vue";
import {
  DEFAULT_EXIT_ANIMATION,
  DEFAULT_EXIT_SPEED,
  REMOVAL_ANIMATION_OPTIONS,
  runRemovalAnimation,
} from "components/stage/removalAnimations";

const props = withDefaults(
  defineProps<{
    animation: string;
    speed: number;
    /** First frame / poster used as the preview subject. */
    previewSrc?: string;
    /** Inline row layout: no labels, no preview box. */
    compact?: boolean;
  }>(),
  { compact: false },
);

const emit = defineEmits<{
  (e: "update:animation", value: string): void;
  (e: "update:speed", value: number): void;
}>();

const animationValue = computed({
  get: () => props.animation || DEFAULT_EXIT_ANIMATION,
  set: (value: string) => emit("update:animation", value),
});

// Same slow↔fast mapping the stage Customisation page used: slider value
// is 1000/duration in [0.1, 1] → duration in [1000, 10000] ms.
const sliderValue = computed({
  get: () => 1000 / (props.speed || DEFAULT_EXIT_SPEED),
  set: (value: number) => {
    emit("update:speed", Math.round(1000 / Math.min(Math.max(value, 0.1), 1)));
  },
});

const instant = computed(() => animationValue.value === "vanish");

const previewBox = ref<HTMLElement>();
const previewing = ref(false);
const playPreview = () => {
  const box = previewBox.value;
  if (!box || previewing.value) return;
  const target = box.querySelector(".object") as HTMLElement | null;
  if (!target) return;
  previewing.value = true;
  runRemovalAnimation(
    animationValue.value,
    box,
    () => {
      // The effects mutate transform/opacity/filter in place; clear them so
      // the subject pops back for the next run.
      window.setTimeout(() => {
        target.style.cssText = "";
        previewing.value = false;
      }, 400);
    },
    { duration: props.speed || DEFAULT_EXIT_SPEED, board: box },
  );
};
</script>

<template>
  <div v-if="compact" class="exit-settings-compact">
    <a-select
      v-model:value="animationValue"
      data-testid="exit-settings-animation"
      :options="REMOVAL_ANIMATION_OPTIONS"
      size="small"
      class="exit-compact-select"
    />
    <div class="exit-speed-row exit-compact-slider">
      <span>Slow</span>
      <a-slider
        v-model:value="sliderValue"
        data-testid="exit-settings-speed"
        :min="0.1"
        :max="1"
        :step="0.01"
        :disabled="instant"
        :tip-formatter="null"
        class="exit-speed-slider"
      />
      <span>Fast</span>
    </div>
  </div>
  <a-space v-else direction="vertical" class="w-full mb-4">
    <a-form-item label="Exit animation" :label-col="{ span: 6 }" class="mb-2">
      <a-select
        v-model:value="animationValue"
        data-testid="exit-settings-animation"
        :options="REMOVAL_ANIMATION_OPTIONS"
        style="max-width: 320px"
      />
    </a-form-item>
    <a-form-item label="Exit speed" :label-col="{ span: 6 }" class="mb-2">
      <div class="exit-speed-row">
        <span>Slow</span>
        <a-slider
          v-model:value="sliderValue"
          data-testid="exit-settings-speed"
          :min="0.1"
          :max="1"
          :step="0.01"
          :disabled="instant"
          :tip-formatter="null"
          class="exit-speed-slider"
        />
        <span>Fast</span>
      </div>
      <div v-if="instant" class="text-gray-500 text-sm">
        "Disappear" is instant; pick another effect to set its speed.
      </div>
    </a-form-item>
    <a-form-item label="Preview" :label-col="{ span: 6 }" class="mb-2">
      <div class="exit-preview-row">
        <div ref="previewBox" class="exit-preview" aria-hidden="true">
          <div class="object">
            <img v-if="previewSrc" :src="previewSrc" alt="" />
            <div v-else class="exit-preview-placeholder"></div>
          </div>
        </div>
        <a-button :disabled="previewing" @click="playPreview">Play</a-button>
      </div>
    </a-form-item>
  </a-space>
</template>

<style scoped>
.exit-settings-compact {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.exit-compact-select {
  width: 210px;
}

.exit-compact-slider {
  /* Without a real minimum the flex row squeezed this to a ~30px sliver
     next to the 210px select (media form's assigned-stage rows) — too small
     to operate at all by touch: every tap landed within the browser's
     touch-adjustment radius of the handle, so taps grabbed the handle
     instead of moving it and the slider felt stuck. Forcing a floor makes
     the row wrap onto its own full-width line instead of shrinking. */
  flex: 1 1 220px;
  min-width: 180px;
  max-width: 260px;
}

.exit-speed-row {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 320px;
}

.exit-speed-slider {
  flex: auto;
}

.exit-preview-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.exit-preview {
  position: relative;
  width: 140px;
  height: 140px;
  overflow: hidden;
  background: repeating-conic-gradient(#f3f3f3 0% 25%, #ffffff 0% 50%) 0 0 / 20px 20px;
  border: 1px solid #e5e5e5;
  border-radius: 6px;
}

.exit-preview .object {
  position: absolute;
  inset: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.exit-preview .object img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.exit-preview-placeholder {
  width: 70%;
  height: 70%;
  border-radius: 50%;
  background: #30ac45;
}
</style>
