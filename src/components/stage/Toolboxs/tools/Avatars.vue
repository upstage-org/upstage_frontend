<script>
import Skeleton from "../Skeleton.vue";
import Icon from "components/Icon.vue";
import { useStageStore } from "@stores/pinia/stage";

export default {
  components: { Skeleton, Icon },
  setup: () => {
    const stageStore = useStageStore();
    const avatars = stageStore.tools.avatars;
    const clearAll = () => stageStore.clearStageObjectsOfKind("avatar");
    return { avatars, clearAll };
  },
};
</script>

<template>
  <div @click="clearAll">
    <div class="icon is-large">
      <Icon size="36" src="clear.svg" />
    </div>
    <span class="tag is-light is-block">{{ $t("clear") }}</span>
  </div>
  <div v-for="avatar in avatars" :key="avatar">
    <Skeleton :data="avatar" />
  </div>
</template>

<style scoped lang="scss"></style>
