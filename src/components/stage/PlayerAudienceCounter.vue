<script>
import Loading from "components/Loading.vue";
import { useCounter } from "./composable";
export default {
  components: { Loading },
  props: { stageUrl: String },
  setup(props) {
    const [players, audiences, loading] = useCounter(props.stageUrl);
    return { players, audiences, loading };
  },
};
</script>

<template>
  <Loading v-if="loading" height="24px" />
  <span v-else-if="players > 0 || audiences > 0" class="tag is-dark is-small">
    <span class="icon">
      <i class="fas fa-user"></i>
    </span>
    <span>{{ players }}</span>
    <span class="icon">
      <i class="fas fa-desktop"></i>
    </span>
    <span>{{ audiences }}</span>
  </span>
</template>

<style></style>
