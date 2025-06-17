<template>
  <a-tooltip :title="dynamicTooltip">
    <div style="position: relative" class="has-tooltip-left">
      <ElasticInput v-if="!pickerOnly" v-bind="$attrs" :model-value="modelValue"
        @update:model-value="$emit('update:modelValue', $event)" @ref="(el) => (input = el)" @submit="$emit('submit')"
        :style="{
          'border-top-right-radius': '20px',
          'border-bottom-right-radius': '20px',
          'padding-right': '40px',
        }" :class="dynamicClass" />
      <div v-click-outside="() => (isPicking = false)" class="emoji-picker-wrapper">
        <button type="button" class="button is-right clickable is-rounded" :class="{
          'is-loading': loading,
          'is-primary': !className,
          [className as string]: true,
          'picker-only': pickerOnly,
        }" :disabled="loading" :style="style" @click="isPicking = !isPicking">
          <slot name="icon">
            <span class="icon" v-if="!loading">
              <Icon size="48" src="emoji.svg" />
            </span>
          </slot>
        </button>
        <transition :css="false" @enter="pickerEnter" @leave="pickerLeave">
          <emoji-picker v-show="isPicking" :class="{ dark: chatDarkMode, light: !chatDarkMode }" />
        </transition>
      </div>
    </div>
  </a-tooltip>
</template>

<script setup lang="ts">
import "emoji-picker-element";
import { computed, ref } from "vue";
import { animate } from "animejs";
import Icon from "components/Icon.vue";
import ElasticInput from "components/form/ElasticInput.vue";
import { useStageStore } from "store/modules/stage";
import { useHoldingShift } from "../stage/composable";

const props = defineProps<{
  loading?: boolean;
  modelValue?: string;
  pickerOnly?: boolean;
  style?: Record<string, string>;
  className?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'submit'): void;
}>();

const input = ref<HTMLInputElement | null>(null);
const isPicking = ref(false);
const stageStore = useStageStore();
const canPlay = computed(() => stageStore.canPlay);
const chatDarkMode = computed(() => stageStore.settings.chatDarkMode);

const isHoldingShift = useHoldingShift();

const handleEmoji = ({ detail: { unicode } }: { detail: { unicode: string } }) => {
  if (props.pickerOnly) {
    emit("update:modelValue", unicode);
  } else {
    const start = input.value?.selectionStart ?? 0;
    const end = input.value?.selectionEnd ?? 0;
    const value = props.modelValue ?? "";
    emit(
      "update:modelValue",
      `${value.substring(0, start)}${unicode}${value.substring(
        end,
        value.length,
      )}`,
    );
  }
  if (!isHoldingShift.value) {
    isPicking.value = false;
  }
};

const pickerEnter = (el: Element, complete: () => void) => {
  el?.addEventListener("emoji-click", handleEmoji as unknown as EventListener);
  el?.shadowRoot?.querySelector("#search")?.setAttribute("placeholder", 'Hold "Shift" key to select multiple');
  animate(el, {
    scaleX: [0, 1],
    scaleY: [0, 1],
    duration: 500,
    onComplete: complete,
  });
};

const pickerLeave = () => {
  if (input.value) {
    input.value.focus();
  }
};

const behavior = computed(() => {
  if (props.modelValue) {
    if (props.modelValue.startsWith(":")) {
      return "think";
    }
    if (props.modelValue.startsWith("!")) {
      return "shout";
    }
    if (canPlay.value && props.modelValue.startsWith("-")) {
      return "audience";
    }
  }
  return "speak";
});

const dynamicClass = computed(() => {
  return {
    think: "has-background-info-light has-text-info",
    shout: "has-background-danger-light has-text-danger",
    audience: "has-background-dark has-text-light",
    speak: '',
  }[behavior.value];
});

const dynamicTooltip = computed(() => {
  return {
    think: "Think",
    shout: "Shout",
    audience: "Audience simulation",
    speak: ''
  }[behavior.value];
});
</script>

<style scoped lang="scss">
emoji-picker {
  --border-size: 0.5px;
  --outline-size: 0;
  --input-border-radius: 24px;
  --input-border-color: #b5b5b5;

  position: absolute;
  bottom: 40px;
  right: 0;
  z-index: 1000;
  overflow: hidden;
  border-radius: 8px;
  box-shadow:
    0 0.5em 1em -0.125em rgba(10, 10, 10, 0.1),
    0 0px 0 1px rgba(10, 10, 10, 0.02);
  transform-origin: bottom right;
}

.emoji-picker-wrapper {
  position: absolute;
  right: 0;
  top: 0;

  .button {
    .icon:first-child:last-child {
      margin: auto;
    }
  }
}
</style>
