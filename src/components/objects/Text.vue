<template>
  <Object :object="object">
    <template #menu="slotProps">
      <MenuContent :object="object" v-bind="slotProps" v-model:active="active" />
    </template>
    <template #render>
      <p ref="el" :style="object" class="has-text-centered" :contenteditable="object.editing" @keyup.delete.prevent.stop
        @keyup="liveTyping" @focus="isFocus = true" @blur="isFocus = false" @mousedown="mousedown"></p>
    </template>
  </Object>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from "vue";
import Object from "./Object.vue";
import MenuContent from "./Avatar/ContextMenuAvatar.vue";
import { useStageStore } from "store/modules/stage";
import { ObjectProps } from "interfaces";

interface Props {
  object: ObjectProps;
}

const props = defineProps<Props>();
const el = ref<HTMLElement | null>(null);
const isFocus = ref(false);
const active = ref(false);
const stageStore = useStageStore();

const liveTyping = () => {
  const content = el.value?.innerHTML ?? "";
  stageStore.shapeObject({
    ...props.object,
    content,
  });
};

onMounted(() => {
  if (el.value) {
    el.value.innerHTML = props.object.content;
  }
});

watch(
  () => props.object.content,
  () => {
    if (!isFocus.value && el.value) {
      el.value.innerHTML = props.object.content;
    }
  }
);

const activeMovable = computed(
  () => stageStore.activeMovable === props.object.id
);
const mousedown = (e: MouseEvent) => {
  if (activeMovable.value && props.object.editing) {
    e.stopPropagation();
  }
};
</script>

<style>
p[contenteditable="true"] {
  outline: none;
  cursor: text;
  white-space: nowrap;
}
</style>
