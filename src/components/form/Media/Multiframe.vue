<script setup>
import { stageGraph } from "services/graphql";
import { useQuery } from "services/graphql/composable";
import { defineProps, watch } from "@vue/runtime-core";
import { reactive } from "vue";
import Switch from "components/form/Switch.vue";
import HorizontalField from "components/form/HorizontalField.vue";
import MultiSelectList from "components/MultiSelectList.vue";
import Asset from "components/Asset.vue";
import DropzoneForm from "components/form/DropzoneForm.vue";
import Selectable from "components/Selectable.vue";

const props = defineProps({
  media: Object,
  form: Object,
});

const { nodes: allMedia, loading: loadingAllMedia } = useQuery(
  stageGraph.mediaList,
);

const uploadedFrames = reactive([]);

const handleDropzone = (files) => {
  console.log(files, props);
  files.forEach((file) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64 = reader.result;
      uploadedFrames.push(base64);
    };
  });
};

const removeUploaded = (index) => {
  uploadedFrames.splice(index, 1);
};

watch(uploadedFrames, (val) => {
  props.form.uploadedFrames = val;
});
</script>

<template>
  <HorizontalField title="Multiframe">
    <Switch v-model="form.multi" class="is-rounded is-success" />
  </HorizontalField>
  <HorizontalField v-if="form.multi">
    <MultiSelectList
      :loading="loadingAllMedia"
      :data="
        allMedia
          ?.filter((item) => !['audio', 'video'].includes(item.assetType.name))
          .map((media) => media.src)
      "
      v-model="form.frames"
      :columnClass="() => 'is-4'"
    >
      <template #render="{ item: src }">
        <Asset :asset="{ src }" />
      </template>
      <template #extras>
        <div
          v-for="(base64, i) in uploadedFrames"
          :key="i"
          class="column item is-3 is-4"
        >
          <Selectable revert @select="removeUploaded(i)">
            <Asset :asset="{ base64 }" />
          </Selectable>
        </div>
        <div class="column item is-12">
          <DropzoneForm @change="handleDropzone" />
        </div>
      </template>
    </MultiSelectList>
  </HorizontalField>
</template>

<style lang="scss">
.upload-frame {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100px;
}
</style>