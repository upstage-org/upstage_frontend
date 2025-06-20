<template>
  <div class="quick-action" v-show="showQuickActions" @mousedown.stop="keepActive" @mouseup.stop="keepActive">
    <button class="button is-rounded is-small" :class="{ 'is-primary': object.liveAction }" @click="toggleLiveAction">
      <i class="fas fa-lightbulb"></i>
    </button>
    <button v-if="object.type === 'text'" :class="{ 'is-primary': object.editing }" class="button is-rounded is-small"
      @click="editText">
      <i class="fas fa-pen"></i>
    </button>
    <button class="button is-rounded is-small" @click="deleteObject">
      <i class="fas fa-times"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useUserStore } from "store/modules/user";
import { useStageStore } from "store/modules/stage";

interface ObjectProps {
  id: string;
  type: string;
  liveAction: boolean;
  editing?: boolean;
  [key: string]: any;
}

interface Props {
  object: ObjectProps;
  active: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'update:active', value: boolean): void;
}>();

// Pinia stores
const userStore = useUserStore();
const stageStore = useStageStore();

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
  () =>
    (isHolding.value || !holdable.value) &&
    activeMovable.value === props.object.id,
);
</script>

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
