<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

// Items are whatever the caller lists: plain strings/numbers or option objects.
type Item = any;

const props = withDefaults(
  defineProps<{
    data?: Item[];
    modelValue?: string | number;
    renderLabel?: (item: Item) => unknown;
    renderValue?: (item: Item) => unknown;
    renderDescription?: (item: Item) => string;
    placeholder?: string;
    isRight?: boolean;
    isUp?: boolean;
    isRounded?: boolean;
    fixed?: boolean;
  }>(),
  {
    renderLabel: (item: Item) => item,
    renderValue: (item: Item) => item,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: unknown): void;
  (e: "select", value: unknown, item: Item): void;
  (e: "open", value: boolean | undefined): void;
}>();

const selectedItem = computed(() =>
  props.data?.find((item) => props.renderValue(item) === props.modelValue),
);
const isActive = ref<boolean>();
watch(isActive, (value) => emit("open", value));
const select = (value: unknown, item: Item) => {
  emit("update:modelValue", value);
  emit("select", value, item);
  isActive.value = false;
};
const el = ref<HTMLElement>();
const scrollIntoView = () => el.value?.querySelector(".is-active")?.scrollIntoView();
onMounted(scrollIntoView);
</script>

<template>
  <div
    v-click-outside="() => (isActive = false)"
    class="dropdown"
    :class="{ 'is-active': isActive, 'is-right': isRight, 'is-up': isUp }"
  >
    <div class="dropdown-trigger">
      <button
        class="button"
        :class="{ 'is-rounded': isRounded }"
        aria-haspopup="true"
        aria-controls="dropdown-menu"
        @click="isActive = !isActive"
      >
        <span v-if="selectedItem">
          <slot name="selected" :item="selectedItem">
            {{ renderLabel(selectedItem) }}
          </slot>
        </span>
        <span v-else>{{ placeholder }}</span>
        <span class="icon is-small">
          <i class="fas fa-angle-down" aria-hidden="true"></i>
        </span>
      </button>
    </div>
    <div id="dropdown-menu" class="dropdown-menu" role="menu">
      <div ref="el" class="dropdown-content" :style="{ position: fixed ? 'fixed' : 'unset' }">
        <template v-if="data && data.length">
          <a
            v-for="item in data"
            :key="item"
            class="dropdown-item"
            :class="{ 'is-active': modelValue === renderValue(item) }"
            @click="select(renderValue(item), item)"
          >
            <slot name="option" :label="renderLabel(item)" :item="item">
              <div v-if="renderDescription" :title="renderDescription(item)">
                <b>{{ renderLabel(item) }}</b>
                <i class="fas fa-info-circle ml-1"></i>
              </div>
              <template v-else>{{ renderLabel(item) }}</template>
            </slot>
          </a>
        </template>
        <div v-else class="dropdown-item">
          <p class="has-text-dark">{{ $t("no_content") }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.dropdown-content {
  max-height: 50vh;
  overflow-y: auto;
}
</style>
