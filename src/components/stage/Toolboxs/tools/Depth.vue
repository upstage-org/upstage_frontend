<template>
  <div v-for="object in objects" :key="object.id">
    <Icon class="current-avatar" v-if="object.holder" :style="{
      filter: `grayscale(${object.id === currentAvatar ? 0 : 1})`,
    }" src="my-avatar.svg" />
    <Skeleton :real="true" :data="object" :ghost="object.holder && object.id !== currentAvatar" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStageStore } from "../../../../store/stage";
import { useUserStore } from "../../../../store/user";
import Skeleton from "../Skeleton.vue";
import Icon from "components/Icon.vue";

const stageStore = useStageStore();
const userStore = useUserStore();

const objects = computed(() => stageStore.getObjects);
const currentAvatar = computed(() => userStore.avatarId);
</script>

<style lang="scss" scoped>
.current-avatar {
  position: absolute;
  z-index: 1;
  transform: translate(-50%, -65%);
  width: 16px;
  height: 16px;
}
</style>
