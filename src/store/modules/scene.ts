import { defineStore } from 'pinia';
import { stageGraph } from 'services/graphql';
import { useMutation } from 'services/graphql/composable';
import { takeSnapshotFromStage } from './stage/reusable';
import { useStageStore } from './stage';
import { message } from 'ant-design-vue';
import html2canvas from 'html2canvas';
import { cropImageFromCanvas } from 'utils/canvas';

interface SceneState {
  isSaving: boolean;
  isLoading: boolean;
}

export const useSceneStore = defineStore('scene', {
  state: (): SceneState => ({
    isSaving: false,
    isLoading: false,
  }),

  actions: {
    async saveScene(name: string) {
      if (!name?.trim()) {
        message.error('Scene name is required!');
        return;
      }

      const stageStore = useStageStore();
      this.isSaving = true;

      try {
        const el = document.querySelector('#board');
        const { width } = el?.getBoundingClientRect() || { width: 0 };
        const canvas = await html2canvas(el as HTMLElement, { scale: 200 / width });
        const preview = cropImageFromCanvas(canvas)?.src;
        const stageId = stageStore.model.id;
        const payload = takeSnapshotFromStage();

        const { save } = useMutation(stageGraph.saveScene);
        await save('Scene saved successfully!', {
          name,
          stageId,
          payload,
          preview,
        });

        await stageStore.loadScenes();
      } catch (error) {
        console.error(error);
      } finally {
        this.isSaving = false;
      }
    },
  },
}); 