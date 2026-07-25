<script>
import { inject, ref, watch } from "vue";
import SaveButton from "components/form/SaveButton.vue";
import { stageGraph } from "services/graphql";
import { useMutation } from "services/graphql/composable";
import Reorder from "./Reorder.vue";

export default {
  components: {
    Reorder,
    SaveButton,
  },
  setup: () => {
    const stage = inject("stage");
    const clearCache = inject("clearCache");

    // Local working copy: Reorder emits the new order here on every drop;
    // nothing touches the stage until Save.
    const selectedMedia = ref((stage.value.assets || []).slice());
    watch(stage, () => {
      selectedMedia.value = (stage.value.assets || []).slice();
    });

    const { loading: saving, save } = useMutation(stageGraph.saveStageMedia);
    const saveOrder = async () => {
      const ids = selectedMedia.value.map((media) => media.id);
      await save("Media order saved!", stage.value.id, ids);
      clearCache();
    };

    return {
      selectedMedia,
      saving,
      saveOrder,
    };
  },
};
</script>

<template>
  <div class="columns is-vcentered">
    <div class="column has-text-left">
      <b><span>Media assigned to this Stage</span></b>
      <p class="reorder-hint">
        Drag and drop the thumbnails into the order you want them to appear in the on-stage tool
        bars, then click Save.
      </p>
    </div>
    <div class="column is-narrow">
      <SaveButton :loading="saving" @click="saveOrder" />
    </div>
  </div>

  <Reorder v-model="selectedMedia" />
</template>

<style scoped>
.reorder-hint {
  margin-top: 0.25rem;
  color: #7a7a7a;
  font-size: 0.9em;
}
</style>
