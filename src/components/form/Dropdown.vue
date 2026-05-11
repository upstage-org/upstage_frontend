<script>
import { computed, onMounted, ref, watch } from "vue";
export default {
  props: {
    data: Array,
    modelValue: [String, Number],
    renderLabel: {
      type: Function,
      default: (item) => item,
    },
    renderValue: {
      type: Function,
      default: (item) => item,
    },
    renderDescription: {
      type: Function,
    },
    placeholder: String,
    isRight: Boolean,
    isUp: Boolean,
    isRounded: Boolean,
    fixed: Boolean,
  },
  emits: ["update:modelValue", "select", "open"],
  setup: (props, { emit }) => {
    const selectedItem = computed(() =>
      props.data?.find((item) => props.renderValue(item) === props.modelValue),
    );
    const isActive = ref();
    watch(isActive, (value) => emit("open", value));
    const select = (value, item) => {
      emit("update:modelValue", value);
      emit("select", value, item);
      isActive.value = false;
    };
    const el = ref();
    const scrollIntoView = () => el.value.querySelector(".is-active")?.scrollIntoView();
    onMounted(scrollIntoView);
    return { select, selectedItem, isActive, el };
  },
};
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
