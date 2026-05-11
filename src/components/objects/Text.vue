<script>
// Aliased: "Object" is a reserved HTML element name (vue/no-reserved-component-names).
import AppObject from "./Object.vue";
import MenuContent from "./Avatar/ContextMenuAvatar.vue"; // Text should inherit all of avatar behavior
import { useStageStore } from "@stores/pinia/stage";
import { computed, onMounted, ref, watch } from "vue";

export default {
  components: { AppObject, MenuContent },
  props: { object: Object },
  setup: (props) => {
    const el = ref();
    const stageStore = useStageStore();

    const isFocus = ref(false);

    const liveTyping = () => {
      const content = el.value.innerHTML;
      stageStore.shapeObject({
        ...props.object,
        content,
      });
    };

    onMounted(() => {
      el.value.innerHTML = props.object.content;
    });
    watch(
      () => props.object.content,
      () => {
        if (!isFocus.value) {
          el.value.innerHTML = props.object.content;
        }
      },
    );

    const activeMovable = computed(() => stageStore.activeMovable === props.object.id);
    const mousedown = (e) => {
      if (activeMovable.value && props.object.editing) {
        e.stopPropagation();
      }
    };

    return { el, liveTyping, isFocus, mousedown };
  },
};
</script>

<template>
  <AppObject :object="object">
    <template #menu="slotProps">
      <MenuContent v-bind="slotProps" v-model:active="active" :object="object" />
    </template>
    <template #render>
      <p
        ref="el"
        :style="object"
        class="has-text-centered"
        :contenteditable="object.editing"
        @keyup.delete.prevent.stop
        @keyup="liveTyping"
        @focus="isFocus = true"
        @blur="isFocus = false"
        @mousedown="mousedown"
      ></p>
    </template>
  </AppObject>
</template>

<style>
p[contenteditable="true"] {
  outline: none;
  cursor: text;
  white-space: nowrap;
}
</style>
