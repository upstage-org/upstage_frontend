<script>
import Field from "components/form/Field.vue";
import SaveButton from "components/form/SaveButton.vue";
import html2canvas from "html2canvas";
import { cropImageFromCanvas } from "utils/canvas";
import { useMutation } from "services/graphql/composable";
import { stageGraph } from "services/graphql";
import { takeSnapshotFromStage } from "store/modules/stage/reusable";
import { useStageStore } from "@stores/pinia/stage";
import { reactive } from "vue";
import { message } from "ant-design-vue";
export default {
  components: { Field, SaveButton },
  emits: ["close"],
  setup: (props, { emit }) => {
    const stageStore = useStageStore();

    const form = reactive({});

    const payload = takeSnapshotFromStage();

    const saveScene = async () => {
      emit("close");
      if (form.name?.trim()) {
        try {
          stageStore.SET_SAVING_SCENE(true);
          const el = document.querySelector("#board");
          const { width } = el.getBoundingClientRect();
          const canvas = await html2canvas(el, { scale: 200 / width });
          const preview = cropImageFromCanvas(canvas)?.src;
          const stageId = stageStore.model.id;
          const { name } = form;
          const { save } = useMutation(stageGraph.saveScene);
          await save("Scene saved successfully!", {
            name,
            stageId,
            payload,
            preview,
          });
          stageStore.loadScenes();
        } catch (error) {
          console.log(error);
        } finally {
          stageStore.SET_SAVING_SCENE(false);
        }
      } else {
        message.error("Scene name is required!");
      }
    };

    return { form, saveScene };
  },
};
</script>

<template>
  <div class="card-header">
    <span class="card-header-title">{{ $t("scene_name") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <Field v-model="form.name" />

    <SaveButton @click="saveScene">{{ $t("save_scene") }}</SaveButton>
  </div>
</template>

<style></style>
