<template>
  <div v-for="avatar in avatars" :key="avatar.id">
    <Skeleton :data="avatar" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Skeleton from "../Skeleton.vue";
import { useStageStore } from "store";
import { storeToRefs } from "pinia";

const stageStore = useStageStore();
const { tools } = storeToRefs(stageStore);

const avatars = computed(() => tools.value.avatars);
</script>

<style scoped lang="scss"></style>
