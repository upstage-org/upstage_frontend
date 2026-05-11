<script>
import Skeleton from "../Skeleton.vue";
import { useStageStore } from "@stores/pinia/stage";

export default {
  components: { Skeleton },
  setup: () => {
    const stageStore = useStageStore();
    const props = stageStore.tools.props;
    return { props };
  },
};
</script>

<template>
  <div v-for="prop in props" :key="prop">
    <Skeleton :data="prop" />
  </div>
</template>

<style scoped lang="scss"></style>
