<template>
  <div @click="createScene" class="is-pulled-left">
    <div class="icon is-large">
      <Icon src="new.svg" size="36" />
    </div>
    <span class="tag is-light is-block">{{ $t("blank_scene") }}</span>
  </div>
</template>

<script setup lang="ts">
import Icon from "components/Icon.vue";
import { useStageStore } from "stores/stage";

const stageStore = useStageStore();

const createScene = async () => {
  if (
    confirm(
      "Create a new blank scene will erase everything on the stage. Make sure your scene is saved before you do this. Are you sure you want to continue?",
    )
  ) {
    stageStore.blankScene();
  }
};
</script>

<style></style>
