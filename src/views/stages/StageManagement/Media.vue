<template>
  <div class="columns">
    <div class="column">
      <b><span>Media assigned to this Stage</span></b>
    </div>
    <div class="column" align="right">
      <SaveButton
        class="mb-4"
        :loading="saving"
        :disabled="!stage?.id"
        @click="saveMediaOrder"
      />
    </div>
  </div>

  <Reorder v-model="selectedMedia" />
</template>

<script>
import MultiSelectList from "components/MultiSelectList.vue";
import Asset from "components/Asset.vue";
import SaveButton from "components/form/SaveButton.vue";
import Dropdown from "components/form/Dropdown.vue";
import Field from "components/form/Field.vue";
import Icon from "components/Icon.vue";
import { inject, computed } from "vue";
import { message } from "ant-design-vue";
import { useMutation } from "services/graphql/composable";
import { stageGraph } from "services/graphql";
import MultiframePreview from "./MultiframePreview.vue";
import Reorder from "./Reorder.vue";

export default {
  components: {
    MultiSelectList,
    Asset,
    SaveButton,
    Dropdown,
    Icon,
    Field,
    MultiframePreview,
    Reorder,
  },
  setup: () => {
    const stage = inject("stage");
    const refresh = inject("refresh");
    const selectedMedia = computed({
      get: () => stage.value?.assets ?? [],
      set: (val) => {
        if (stage.value) stage.value.assets = val;
      },
    });
    const { loading: saving, save } = useMutation(stageGraph.saveStageMedia);
    const saveMediaOrder = async () => {
      if (!stage.value?.id) return;
      const mediaIds = (selectedMedia.value ?? []).map((m) => m.id);
      await save(
        () => {
          message.success("Media order saved!");
          refresh(stage.value.id);
        },
        stage.value.id,
        mediaIds
      );
    };
    return { stage, selectedMedia, saving, saveMediaOrder };
  },
};
</script>

<style scoped lang="scss">
.media-preview {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0;
  width: 48px;
  height: 48px;
  border-radius: 5px;
  overflow: hidden;
}

.type-icon {
  align-self: center;
  padding: 0 16px;
}
</style>
