<script>
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
export default {
  props: {
    object: Object,
    active: Boolean,
  },
  emits: ["update:active"],
  setup: (props, { emit }) => {
    const stageStore = useStageStore();
    // Compare the object's MQTT-derived holder session to the local
    // session, NOT to `userStore.avatarId`. The local user store's
    // `avatarId` ref drifts out of sync in normal flows (multi-avatar
    // placement, page refresh, echoed counter messages), which made
    // the QuickAction toolbar render for the wrong performer. See the
    // matching comment in Topping.vue and the canonical check already
    // used by Object.vue / ContextMenuAvatar.vue.
    const isHolding = computed(() => props.object.holder?.id === stageStore.session);

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
