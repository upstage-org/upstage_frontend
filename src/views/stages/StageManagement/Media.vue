<template>
  <div class="columns">
    <div class="column">
      <b><span >Media assigned to this Stage</span></b>
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
import { inject } from "vue";
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

    return {  selectedMedia: stage.value.assets || [] };
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
