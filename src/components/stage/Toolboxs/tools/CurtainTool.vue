<template>
  <div @click="toggleCurtain(null)">
    <div class="icon is-large">
      <Icon size="36" src="clear.svg" />
    </div>
    <span class="tag is-light is-block">{{ $t("no_curtain") }}</span>
  </div>
  <div v-for="curtain in curtains" :key="curtain" :class="{
    active: curtain.src === currentCurtain,
  }">
    <Skeleton :data="curtain" nodrop>
      <Image :src="curtain.src" :title="curtain.name" @click="toggleCurtain(curtain.src)" />
    </Skeleton>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Image from "components/Image.vue"
import Icon from "components/Icon.vue"
import Skeleton from "../Skeleton.vue"
import { useStageStore } from 'store'

const stageStore = useStageStore()

const curtains = computed(() => stageStore.tools.curtains)
const currentCurtain = computed(() => stageStore.curtain)

const toggleCurtain = (curtain: string | null) => {
  if (currentCurtain.value === curtain) {
    stageStore.drawCurtain(null)
  } else {
    stageStore.drawCurtain(curtain)
  }
}
</script>

<style scoped lang="scss"></style>
