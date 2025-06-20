import { defineStore } from 'pinia';
import { stageGraph, userGraph } from 'services/graphql';
import { useAttribute, useMutation, useQuery, useRequest } from 'services/graphql/composable';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { handleError } from 'utils/common';
import { useCacheStore } from './cache';

interface StageManagementState {
  form: {
    fileLocation: string;
    name: string;
    description: string;
    status: string;
    visibility: boolean;
    cover: string | null;
    ownerId: string | null;
    playerAccess: string;
    id?: string;
  };
  loading: boolean;
  validatingURL: boolean;
  urlValid: boolean;
  playerAccess: any[];
}

export const useStageManagementStore = defineStore('stageManagement', {
  state: (): StageManagementState => ({
    form: {
      fileLocation: '',
      name: '',
      description: '',
      status: 'rehearsal',
      visibility: true,
      cover: null,
      ownerId: null,
      playerAccess: '',
    },
    loading: false,
    validatingURL: false,
    urlValid: false,
    playerAccess: [],
  }),

  actions: {
    setForm(form: Partial<StageManagementState['form']>) {
      this.form = { ...this.form, ...form };
    },

    setPlayerAccess(access: any[]) {
      this.playerAccess = access;
      this.form.playerAccess = JSON.stringify(access);
    },

    async createStage() {
      try {
        const { mutation } = useMutation(stageGraph.createStage, this.form);
        const stage = await mutation();
        message.success('Stage created successfully!');
        
        const cacheStore = useCacheStore();
        await cacheStore.fetchStages();
        
        const router = useRouter();
        router.push(`/stages/stage-management/${stage.id}/`);
      } catch (error) {
        message.error(error);
      }
    },

    async updateStage() {
      try {
        const { mutation } = useMutation(stageGraph.updateStage, this.form);
        await mutation();
        message.success('Stage updated successfully!');
        
        const cacheStore = useCacheStore();
        cacheStore.updateStageVisibility({
          stageId: this.form.id,
          visibility: this.form.visibility,
        });
        
        return true;
      } catch (error) {
        handleError(error);
        return false;
      }
    },

    async checkURL(url: string, currentStageUrl: string | null) {
      const preservedPaths = [
        'backstage',
        'login',
        'register',
        'static',
        'studio',
        'replay',
        'api',
      ];

      const validRegex = /^[a-zA-Z0-9-_]*$/;
      
      if (!url || !validRegex.test(url) || preservedPaths.includes(url)) {
        this.urlValid = false;
        return;
      }

      this.validatingURL = true;
      try {
        const { fetch } = useRequest(stageGraph.stageList);
        const response = await fetch({ fileLocation: url });
        
        this.urlValid = true;
        if (response.stages.length) {
          const existingStage = response.stages[0];
          if (existingStage.fileLocation !== currentStageUrl) {
            this.urlValid = false;
          }
        }
      } finally {
        this.validatingURL = false;
      }
    },

    getUrlError(url: string): string | null {
      const preservedPaths = [
        'backstage',
        'login',
        'register',
        'static',
        'studio',
        'replay',
        'api',
      ];

      const validRegex = /^[a-zA-Z0-9-_]*$/;
      
      if (!validRegex.test(url)) {
        return 'URL cannot contain special characters or spaces!';
      }
      if (preservedPaths.includes(url.trim())) {
        return `These URL are not allowed: ${preservedPaths.join(', ')}`;
      }
      if (!this.urlValid && url) {
        return 'This URL already existed!';
      }
      return null;
    },

    async afterDelete() {
      const cacheStore = useCacheStore();
      await cacheStore.fetchStages();
      const router = useRouter();
      router.push('/stages');
    },

    async afterDuplicate() {
      const cacheStore = useCacheStore();
      await cacheStore.fetchStages();
    }
  }
}); 