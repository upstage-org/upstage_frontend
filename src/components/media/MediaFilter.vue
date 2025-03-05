<script lang="ts" setup>
import { ref, watch, watchEffect, inject, computed, onMounted } from "vue";
import { useQuery } from "@vue/apollo-composable";
import { useDebounceFn } from "@vueuse/core";
import gql from "graphql-tag";
import { StudioGraph, UploadFile } from "models/studio";
import {editingMediaVar, inquiryVar } from "apollo";
import moment, { Moment } from "moment";
import configs from "config";
import { capitalize, getSharedAuth } from "utils/common";
import Navbar from "../Navbar.vue";
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

const { result: response, loading } = useQuery(gql`
  {
    whoami {
      username
      displayName
      roleName
    }
    users(active: true) {
      id
      username
      displayName
    }
    stages(input:{}) {
      edges {
        id
        name
        createdOn
        owner {
          username
          displayName
        }
      }
    }
    tags {
      id
      name
      color
      createdOn
    }
    mediaTypes {
      id
      name
    }
  }
`);

const result = computed(() => response?.value);

const sharedAuth = getSharedAuth();

const name = ref("");
const owners = ref(
  sharedAuth && sharedAuth.username ? [sharedAuth.username] : [],
);
const types = ref([]);
const stages = ref([]);
const tags = ref([]);
const dates = ref<[Dayjs, Dayjs] | undefined>();

const ranges = [
  {
    label: 'Today',
    value: [dayjs(), dayjs()],
  },
  {
    label: 'Yesterday',
    value: [dayjs().add(-1, 'd'), dayjs().add(-1, 'd')],
  },
  {
    label: 'Last 7 days',
    value: [dayjs().add(-7, 'd'), dayjs()],
  },
  {
    label: 'Last month',
    value: [dayjs().add(-1, 'month'), dayjs()],
  },
  {
    label: 'This year',
    value: [dayjs().startOf("year"), dayjs()],
  }
];

const updateInquiry = (vars: any) =>
  inquiryVar({
    ...inquiryVar(),
    ...vars,
  });

const watchInquiryVar = (vars: any) => {
  types.value = vars.mediaTypes ?? [];
  tags.value = vars.tags ?? [];
  inquiryVar.onNextChange(watchInquiryVar);
};
inquiryVar.onNextChange(watchInquiryVar);

watchEffect(() => {
  updateInquiry({
    owners: owners.value,
    stages: stages.value,
    tags: tags.value,
    mediaTypes: types.value,
  });
});
watch(
  name,
  useDebounceFn(() => {
    updateInquiry({ name: name.value });
  }, 500),
);

const onRangeChange = (_dates: null | (Dayjs | null)[], dateStrings: string[]) => {
  updateInquiry({
    createdBetween: _dates
      ? [
        _dates[0]?.format("YYYY-MM-DD"),
        _dates[1]?.format("YYYY-MM-DD"),
      ]
      : undefined,
  });
};

onMounted(() => {
  updateInquiry({
    createdBetween: undefined
  });
});

const clearFilters = () => {
  name.value = "";
  owners.value = [];
  types.value = [];
  stages.value = [];
  tags.value = [];
  dates.value = undefined;
};
const hasFilter = computed(
  () =>
    name.value ||
    owners.value.length ||
    types.value.length ||
    stages.value.length ||
    tags.value.length ||
    dates.value,
);
const handleFilterOwnerName = (keyword: string, option: any) => {
  const s = keyword.toLowerCase();
  return (
    option.value.toLowerCase().includes(s) ||
    option.label.toLowerCase().includes(s)
  );
};
const handleFilterStageName = (keyword: string, option: any) => {
  return option.label.toLowerCase().includes(keyword.toLowerCase());
};

const visibleDropzone = inject("visibleDropzone");
const composingMode = inject("composingMode");

const VNodes = (_: any, { attrs }: { attrs: any }) => {
  return attrs.vnodes;
};
const onVisibleDropzone = () => {
  editingMediaVar(undefined);
}
</script>

<template>
  <a-affix :offset-top="0">
    <a-space class="shadow rounded-xl px-4 py-2 bg-white flex justify-between">
      <a-space class="flex-wrap">
        <a-button v-if="composingMode" type="primary" danger @click="composingMode = false">
          <template #icon>
            <RollbackOutlined />
          </template>
          Back to editing
        </a-button>
        <a-button type="primary" v-else @click="visibleDropzone = true; onVisibleDropzone();">
          <PlusOutlined /> {{ $t("new") }} {{ $t("media") }}
        </a-button>
        <a-input-search allowClear class="w-48" placeholder="Search media" v-model:value="name" />
        <a-select allowClear showArrow :filterOption="handleFilterOwnerName" mode="tags" style="min-width: 124px"
          placeholder="Owners" :loading="loading" v-model:value="owners" :options="result
            ? result.users.map((e: any) => ({
              value: e.username,
              label: e.displayName || e.username,
            }))
            : []
            ">
          <template #dropdownRender="{ menuNode: menu }">
            <v-nodes :vnodes="menu" />
            <a-divider style="margin: 4px 0" />
            <div class="w-full cursor-pointer text-center" @mousedown.prevent @click.stop.prevent="owners = []">
              <team-outlined />&nbsp;All players
            </div>
          </template>
        </a-select>
        <a-select allowClear showArrow filterOption mode="tags" style="min-width: 128px" placeholder="Media types"
          :loading="loading" v-model:value="types" :options="result
            ? result.mediaTypes
              .filter(
                (e: any) =>
                  !['shape', 'media'].includes(e.name.toLowerCase()),
              )
              .map((e: any) => ({
                value: e.name,
                label: capitalize(e.name),
              }))
            : []
            ">
        </a-select>
        <a-select allowClear showArrow :filterOption="handleFilterStageName" mode="tags" style="min-width: 160px"
          placeholder="Stages assigned" :loading="loading" v-model:value="stages" :options="result
            ? result.stages.edges.map((e: any) => ({
              value: e.id,
              label: e.name,
            }))
            : []
            ">
        </a-select>
        <a-select allowClear showArrow mode="tags" style="min-width: 160px" placeholder="Tags" :loading="loading"
          v-model:value="tags" :options="result
            ? result.tags.map((e: any) => ({
              value: e.name,
              label: e.name,
            }))
            : []
            "></a-select>
        <a-range-picker :placeholder="['Created from', 'to date']" :presets="ranges as any"
          :onChange="onRangeChange as any" v-model:value="dates as any" />
        <a-button v-if="hasFilter" type="dashed" @click="clearFilters">
          <ClearOutlined />Clear Filters
        </a-button>
      </a-space>
      <Navbar />
    </a-space>
  </a-affix>
</template>
