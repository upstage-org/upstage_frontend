<script>
import { useStageStore } from "@stores/pinia/stage";
// Aliased: "Image" is a reserved HTML element name (vue/no-reserved-component-names).
import AppImage from "components/Image.vue";
import Icon from "components/Icon.vue";
import { computed } from "vue";
import Skeleton from "../Skeleton.vue";

export default {
  components: { AppImage, Icon, Skeleton },
  setup: () => {
    const stageStore = useStageStore();
    const curtains = stageStore.tools.curtains;

    const currentCurtain = computed(() => stageStore.curtain);
    const toggleCurtain = (curtain) => {
      if (currentCurtain.value === curtain) {
        stageStore.drawCurtain(null);
      } else {
        stageStore.drawCurtain(curtain);
      }
    };

    return { curtains, toggleCurtain, currentCurtain };
  },
};
</script>

<template>
  <div @click="toggleCurtain(null)">
    <div class="icon is-large">
      <Icon size="36" src="clear.svg" />
    </div>
    <span class="tag is-light is-block">{{ $t("no_curtain") }}</span>
  </div>
  <div
    v-for="curtain in curtains"
    :key="curtain"
    :class="{
      active: curtain.src === currentCurtain,
    }"
  >
    <Skeleton :data="curtain" nodrop>
      <AppImage :src="curtain.src" :title="curtain.name" @click="toggleCurtain(curtain.src)" />
    </Skeleton>
  </div>
</template>

<style scoped lang="scss"></style>
