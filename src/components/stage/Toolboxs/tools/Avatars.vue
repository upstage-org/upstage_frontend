<script setup lang="ts">
import Skeleton from "../Skeleton.vue";
import Icon from "components/Icon.vue";
import { useStageStore } from "@stores/pinia/stage";

const stageStore = useStageStore();
const avatars = stageStore.tools.avatars as any[];
const clearAll = () => stageStore.clearStageObjectsOfKind("avatar");
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
