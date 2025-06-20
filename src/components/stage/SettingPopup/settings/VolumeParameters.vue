<template>
  <div class="card-header">
    <span class="card-header-title">{{ $t("volumne_setting") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <div class="content">
      <HorizontalField title="Volume">
        <a-slider v-model:value="volume" :min="0" :max="100" />
      </HorizontalField>
      <SaveButton @click="saveVolume" :loading="loading" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useStageStore } from 'store';
import { useVolumeStore } from 'store/modules/volume';
import HorizontalField from '@/components/form/HorizontalField.vue';
import SaveButton from '@/components/form/SaveButton.vue';

const stageStore = useStageStore();
const volumeStore = useVolumeStore();

const volume = computed({
  get: () => volumeStore.volume,
  set: (value: number) => volumeStore.setVolume(value)
});

const loading = computed(() => volumeStore.loading);

onMounted(() => {
  const currentAvatar = stageStore.activeObject;
  if (currentAvatar?.volume !== undefined) {
    volumeStore.setVolume(currentAvatar.volume);
  }
});

const saveVolume = async () => {
  await volumeStore.updateVolume(volume.value);
};
</script>

<style lang="scss"></style>
