<script>
import Skeleton from "../Skeleton.vue";
import { useStore } from "vuex";

export default {
  components: { Skeleton },
  setup: () => {
    const store = useStore();
    const props = store.state.stage.tools.props;
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
