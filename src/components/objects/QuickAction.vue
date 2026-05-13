<script>
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
export default {
  props: {
    object: Object,
    active: Boolean,
  },
  emits: ["update:active"],
  setup: (props, { emit }) => {
    const stageStore = useStageStore();
    const userStore = useUserStore();
    // `store.state.user.avatarId` was a broken read after the user
    // module moved to Pinia in Phase 5; Pinia user store is the
    // correct source.
    const isHolding = computed(() => props.object.id === userStore.avatarId);

    const keepActive = () => {
      emit("update:active", true);
    };

    const toggleLiveAction = () => {
      stageStore.shapeObject({
        ...props.object,
        liveAction: !props.object.liveAction,
      });
    };

    const deleteObject = () => {
      stageStore.deleteObject(props.object);
    };

    const editText = () => {
      stageStore.shapeObject({
        ...props.object,
        editing: !props.object.editing,
      });
    };

    const holdable = computed(() => ["avatar"].includes(props.object.type));
    const activeMovable = computed(() => stageStore.activeMovable);
    const showQuickActions = computed(
      () => (isHolding.value || !holdable.value) && activeMovable.value === props.object.id,
    );

    return {
      deleteObject,
      keepActive,
      toggleLiveAction,
      isHolding,
      showQuickActions,
      editText,
    };
  },
};
</script>

<template>
  <div
    v-show="showQuickActions"
    class="quick-action"
    @mousedown.stop="keepActive"
    @mouseup.stop="keepActive"
  >
    <button
      class="button is-rounded is-small"
      :class="{
        'is-primary': object.liveAction,
        'is-danger': object.liveAction === false,
      }"
      @click="toggleLiveAction"
    >
      <i class="fas fa-lightbulb"></i>
    </button>
    <button
      v-if="object.type === 'text'"
      :class="{ 'is-primary': object.editing }"
      class="button is-rounded is-small"
      @click="editText"
    >
      <i class="fas fa-pen"></i>
    </button>
    <button class="button is-rounded is-small" @click="deleteObject">
      <i class="fas fa-times"></i>
    </button>
  </div>
</template>

<style scoped lang="scss">
.quick-action {
  position: absolute;
  width: min-content;
  right: -40px;
  button {
    width: 16px;
    margin-bottom: 4px;
  }
}
</style>
