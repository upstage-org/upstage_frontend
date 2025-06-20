<template>
  <div v-for="prop in props" :key="prop">
    <Skeleton :data="prop" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Skeleton from "../Skeleton.vue";
import { useStageStore } from "store";

const stageStore = useStageStore();
const props = computed(() => stageStore.tools.props);
</script>

<style scoped lang="scss"></style>
