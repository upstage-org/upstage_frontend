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

const visible = ref(false);
const keyword = ref("");
const isAdmin = computed(() => store.getters["user/isAdmin"]);
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
    const s = keyword.value.trim();
    return result.value.stages.edges
      .filter((el: any) => {
        return isAdmin.value ? true : (el.permission == "editor" || el.permission == "owner")
      }).filter((node: any) => {
        if (node.name.toLowerCase().includes(s)) {
          return true;
        }
        return false;
      });
  }
  return [];
});

const { mutate } = useMutation<
  { quickAssignMutation: { asset: Media } },
  { assetId: string; stageId: string }
>(gql`
  mutation QuickAssignMutation($assetId: ID!, $stageId: ID!) {
    quickAssignMutation(assetId: $assetId, stageId: $stageId) {
      success
      message
    }
  }
`);

const refresh = inject("refresh", () => { });
const quickAssign = async (stage: Stage) => {
  await mutate({
    assetId: props.media.id,
    stageId: stage.id,
  });
  message.success(
    `${props.media.name} had been assigned to ${stage.name} successfully!`,
  );
  refresh();
};
</script>

<template>
  <a-button class="ml-2" type="primary" @click="visible = true">
    <plus-circle-outlined />Assign to stage
  </a-button>
  <a-modal v-model:visible="visible" class="custom-class" style="color: red"
    title="Assign this media to one of your stages" :width="600">
    <div class="flex" style="align-items: center; justify-content: flex-start;">
      <div style="max-width: 350px;">
      <MediaPreview v-if="media.assetType" :media="media as Media" />
      </div>
      &nbsp;&nbsp;&nbsp;
      <h3 style="color: black;">{{ media.name }}</h3>
    </div>
    <br />
    <div class="flex">
      <a-input-search class="mr-2" placeholder="Stage name" v-model:value="keyword"></a-input-search>
    </div>
    <a-list class="demo-loadmore-list" :loading="loading" item-layout="horizontal" :data-source="dataSource">
      <template #renderItem="{ item }">
        <a-list-item class="p-0">
          <template #actions>
            <a-tooltip v-if="media.stages.some((s) => s.id === item.id)" title="Already assigned" placement="topRight">
              <a-button disabled>
                <check-outlined />
              </a-button>
            </a-tooltip>
            <a-tooltip v-else :title="`Assign ${media.name} to this stage`" placement="topRight">
              <smart-button :action="() => quickAssign(item)" type="primary">
                <plus-outlined />
              </smart-button>
            </a-tooltip>
          </template>
          <a-list-item-meta>
            <template #title>
              <a-button type="text" class="p-0" style="position: relative; top: 8px">{{ item.name }}</a-button>
            </template>
            <template #description>
              <small style="position: relative; top: -4px">
                Created by {{ item.owner.displayName || item.owner.username }}
                <d-date :value="item.createdOn"></d-date>
              </small>
            </template>
          </a-list-item-meta>
        </a-list-item>
      </template>
    </a-list>
  </a-modal>
</template>
