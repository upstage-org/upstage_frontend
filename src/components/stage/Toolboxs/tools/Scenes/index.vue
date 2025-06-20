<template>
  <BlankScene />
  <Scene v-for="scene in scenes" :key="scene.id" :scene="scene" />
  <div v-if="isSaving">
    <Loading height="64px" />
  </div>
  <div v-else @click="saveScene" class="is-pulled-left">
    <div class="icon is-large">
      <Icon src="save.svg" size="36" />
    </div>
    <span class="tag is-light is-block">{{ $t("save_scene") }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Icon from "components/Icon.vue";
import Loading from "components/Loading.vue";
import Scene from "./Scene.vue";
import BlankScene from "./BlankScene.vue";
import { useScenesStore } from "stores/scenes";
import { useStageStore } from "store";

const scenesStore = useScenesStore();
const stageStore = useStageStore();

const isSaving = computed(() => stageStore.isSavingScene);
const scenes = computed(() => scenesStore.scenes);

const saveScene = () => {
  stageStore.openSettingPopup({
    type: "SaveScene",
  });
};
</script>

<style lang="scss" scoped>
@mixin gradientText($from, $to) {
  background: linear-gradient(to top, $from, $to);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.fas.fa-plus {
  @include gradientText(#30ac45, #6fb1fc);
}

video {
  height: 100%;
}
</style>
