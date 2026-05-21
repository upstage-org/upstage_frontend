<script>
import Skeleton from "../Skeleton.vue";
import { useStageStore } from "@stores/pinia/stage";

export default {
  components: { Skeleton },
  setup: () => {
    const stageStore = useStageStore();
    const avatars = stageStore.tools.avatars;
    return { avatars };
  },
};
</script>

<template>
  <div v-for="avatar in avatars" :key="avatar">
    <Skeleton :data="avatar" />
  </div>
</template>

<style scoped lang="scss"></style>
