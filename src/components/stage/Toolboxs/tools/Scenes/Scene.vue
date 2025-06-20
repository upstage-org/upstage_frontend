<template>
  <div @click="handleSwitchScene">
    <ContextMenu style="width: 100%; height: 100%; padding: 0" prevent-clicking>
      <template #trigger>
        <Skeleton :data="scene" nodrop>
          <div class="p-2 is-fullwidth is-flex is-flex-direction-column is-justify-content-space-between"
            :title="scene.name">
            <Image :src="scene.scenePreview" style="height: auto; border-radius: 4px" />
            <span class="tag mt-1 is-block">{{ scene.name }}</span>
          </div>
        </Skeleton>
      </template>
      <template #context>
        <a class="panel-block has-text-danger" @click="handleDeleteScene">
          <span class="panel-icon">
            <Icon src="remove.svg" />
          </span>
          <span>{{ $t("delete_scene") }}</span>
        </a>
      </template>
    </ContextMenu>
  </div>
</template>

<script setup lang="ts">
import { defineProps } from 'vue'
import Icon from "components/Icon.vue"
import Image from "components/Image.vue"
import ContextMenu from "components/ContextMenu.vue"
import Skeleton from "../../Skeleton.vue"
import { useScenesStore } from 'stores/scenes'

interface Scene {
  id: string
  name: string
  scenePreview: string
  payload: string
}

const props = defineProps<{
  scene: Scene
}>()

const scenesStore = useScenesStore()

const handleSwitchScene = () => {
  scenesStore.switchScene(props.scene.id)
}

const handleDeleteScene = () => {
  scenesStore.deleteScene(props.scene.id)
}
</script>

<style scoped>
.tag {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
