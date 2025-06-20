import { defineStore } from 'pinia';
import { useStageStore } from './stage';

interface VolumeState {
  volume: number;
  loading: boolean;
}

export const useVolumeStore = defineStore('volume', {
  state: (): VolumeState => ({
    volume: 0,
    loading: false,
  }),

  actions: {
    async updateVolume(volume: number) {
      this.loading = true;
      try {
        const stageStore = useStageStore();
        const currentAvatar = stageStore.activeObject;
        
        if (currentAvatar) {
          const video = document.getElementById(`video${currentAvatar.id}`) as HTMLVideoElement;
          if (video) {
            video.volume = volume / 100;
          }
          
          await stageStore.updateObject({
            ...currentAvatar,
            volume,
          });
        }
      } finally {
        this.loading = false;
      }
    },

    setVolume(volume: number) {
      this.volume = volume;
    },
  },
}); 