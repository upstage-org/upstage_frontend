<!--
  Per-media exit (removal) animation picker. Parent (MediaForm) passes a
  shared reactive `exit` object ({ animation, speed }) and this child
  mutates it in place — same contract as PropLink/AvatarVoice.

  `animation === ""` means "Stage default": the media carries no override
  and leaves the stage with the stage-configured effect. The speed slider
  only applies (and is only saved) when a specific effect is chosen.
-->
<!-- eslint-disable vue/no-mutating-props -->
<script lang="ts" setup>
import { computed, ref } from "vue";
import { REMOVAL_ANIMATION_OPTIONS, runRemovalAnimation } from "components/stage/removalAnimations";

const props = defineProps<{
  exit: { animation: string; speed: number };
  /** First frame / poster used as the preview subject. */
  previewSrc?: string;
}>();

const options = computed(() => [
  { value: "", label: "Stage default" },
  ...REMOVAL_ANIMATION_OPTIONS,
]);

// Same slow↔fast mapping the stage Customisation page used: slider value
// is 1000/duration in [0.1, 1] → duration in [1000, 10000] ms.
const sliderValue = computed({
  get: () => 1000 / (props.exit.speed || 1000),
  set: (value: number) => {
    props.exit.speed = Math.round(1000 / Math.min(Math.max(value, 0.1), 1));
  },
});

const previewBox = ref<HTMLElement>();
const previewing = ref(false);
const playPreview = () => {
  const box = previewBox.value;
  if (!box || previewing.value) return;
  const target = box.querySelector(".object") as HTMLElement | null;
  if (!target) return;
  previewing.value = true;
  runRemovalAnimation(
    props.exit.animation || "spiral",
    box,
    () => {
      // The effects mutate transform/opacity/filter in place; clear them so
      // the subject pops back for the next run.
      window.setTimeout(() => {
        target.style.cssText = "";
        previewing.value = false;
      }, 400);
    },
    { duration: props.exit.speed || 1000, board: box },
  );
};
</script>

<template>
  <!-- eslint-disable vue/no-mutating-props -->
  <a-space direction="vertical" class="w-full mb-4">
    <a-form-item label="Exit animation" :label-col="{ span: 6 }" class="mb-2">
      <a-select
        v-model:value="props.exit.animation"
        data-testid="media-form-exit-animation"
        :options="options"
        style="max-width: 320px"
      />
    </a-form-item>
    <a-form-item label="Exit speed" :label-col="{ span: 6 }" class="mb-2">
      <div class="exit-speed-row">
        <span>Slow</span>
        <a-slider
          v-model:value="sliderValue"
          data-testid="media-form-exit-speed"
          :min="0.1"
          :max="1"
          :step="0.01"
          :disabled="!props.exit.animation"
          :tip-formatter="null"
          class="exit-speed-slider"
        />
        <span>Fast</span>
      </div>
      <div v-if="!props.exit.animation" class="text-gray-500 text-sm">
        Pick an effect above to set its speed; "Stage default" uses the stage's own settings.
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
