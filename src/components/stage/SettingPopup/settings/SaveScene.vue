<template>
  <div class="card-header">
    <span class="card-header-title">{{ $t("scene_name") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <Field v-model="sceneName" />

    <SaveButton @click="handleSaveScene" :loading="isSaving">{{ $t("save_scene") }}</SaveButton>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import Field from "components/form/Field.vue";
import SaveButton from "components/form/SaveButton.vue";
import { useSceneStore } from 'store/modules/scene';

const emit = defineEmits(['close']);
const sceneStore = useSceneStore();
const sceneName = ref('');

const handleSaveScene = async () => {
  await sceneStore.saveScene(sceneName.value);
  emit('close');
};

const isSaving = computed(() => sceneStore.isSaving);
</script>

<style></style>
