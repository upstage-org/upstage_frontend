<script setup lang="ts">
import { useMutation, useQuery } from "@vue/apollo-composable";
import { message } from "ant-design-vue";
import gql from "graphql-tag";
import { computed, inject, PropType, ref } from "vue";
import { Media, Stage } from "models/studio";
import store from "store";
import MediaPreview from "./MediaPreview.vue";

const props = defineProps({
  media: {
    type: Object as PropType<Media>,
    required: true,
  },
});
const stages = ref([]);
const visible = ref(false);
const isAdmin = computed(() => store.getters["user/isAdmin"]);
const note = computed(() => {
  try {
    const description = JSON.parse(props.media.description);
    return description?.note;
  } catch (err) {
    return ""
  }
});
const { result, loading } = useQuery(
  gql`
    {
      whoami {
        username
      }
      stages(input:{})  {
        edges {
          id
          name
          createdOn
          permission
          owner {
            username
            displayName
          }
        }
      }
    }
  `,
  null,
  {

  },
);

const dataSource = computed(() => {
  if (result.value) {
    return result.value.stages.edges
      .filter((el: any) => {
        return (isAdmin.value ? true : (el.permission == "editor" || el.permission == "owner")) && !props.media.stages.some((s) => s.id === el.id)
      });
  }
  return [];
});
const handleFilterStageName = (keyword: string, option: any) => {
  return option.label.toLowerCase().includes(keyword.toLowerCase());
};
const { mutate } = useMutation<
  { quickAssignMutation: { asset: Media } },
  { assetId: string; stageIds: [string] }
>(gql`
  mutation QuickAssignMutation($assetId: ID!, $stageIds: [ID]!) {
    quickAssignMutation(assetId: $assetId, stageIds: $stageIds) {
      success
      message
    }
  }
`);

const refresh = inject("refresh", () => { });

const handleOk = async () => {
  const stageIds: any = stages.value;
  await mutate({
    assetId: props.media.id,
    stageIds: stageIds,
  });
  message.success(
    `${props.media.name} had been assigned successfully!`,
  );
  refresh();
  stages.value = [];
  visible.value = false;
}
</script>

<template>
  <a-button class="ml-2" type="primary" @click="visible = true">
    <plus-circle-outlined />Assign to stage
  </a-button>
  <a-modal v-model:visible="visible" class="custom-class" style="color: red"
    title="Assign this media to one of your stages" :width="600" @ok="handleOk"
    :okButtonProps="{ disabled: stages.length <= 0 }">
    <div class="flex" style="align-items: center; justify-content: flex-start;">
      <div style="max-width: 350px;">
        <MediaPreview v-if="media.assetType" :media="media as Media" />
      </div>
      &nbsp;&nbsp;&nbsp;
      <h4 style="color: black;">{{ media.name }}</h4>
    </div>
    <h3 style="color: black; margin-top: 20px;">{{ media.copyrightLevel == 1 && note }}</h3>
    <div class="flex">
      <a-select allowClear showArrow :filterOption="handleFilterStageName" mode="tags" style="width: 100%;"
        placeholder="Stage name" :loading="loading" v-model:value="stages" :options="dataSource
          ? dataSource.map((e: any) => ({
            value: e.id,
            label: e.name,
          }))
          : []
          ">
      </a-select>
    </div>
  </a-modal>
</template>
