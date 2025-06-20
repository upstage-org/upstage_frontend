import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useCurtainStore = defineStore('curtain', () => {
  const curtain = ref<string | null>(null);
  const config = ref({
    animations: {
      curtain: 'default',
      curtainSpeed: 3000
    }
  });

  const canPlay = ref(false);
  const dualCurtain = computed(() => config.value?.animations?.curtain === 'close');
  const curtainSpeed = computed(() => config.value?.animations?.curtainSpeed ?? 3000);

  function setCurtain(newCurtain: string | null) {
    curtain.value = newCurtain;
  }

  function setConfig(newConfig: any) {
    config.value = newConfig;
  }

  function setCanPlay(value: boolean) {
    canPlay.value = value;
  }

  return {
    curtain,
    config,
    canPlay,
    dualCurtain,
    curtainSpeed,
    setCurtain,
    setConfig,
    setCanPlay
  };
}); 