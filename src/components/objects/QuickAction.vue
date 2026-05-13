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

    // Tooltip text for the lightbulb's three states. The wording matches
    // what the click does next:
    //   white  -> click to show on stage (first publish)
    //   green  -> click to pause broadcast (changes won't be sent)
    //   red    -> click to resume broadcast (audience catches up)
    const bulbTitle = computed(() => {
      if (props.object.liveAction) return "Pause broadcast";
      if (props.object.published) return "Resume broadcast";
      return "Show on stage";
    });

    return {
      deleteObject,
      keepActive,
      toggleLiveAction,
      isHolding,
      showQuickActions,
      editText,
      bulbTitle,
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
        'is-danger': !object.liveAction && object.published,
      }"
      :title="bulbTitle"
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
