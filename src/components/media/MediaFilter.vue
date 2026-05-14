<script lang="ts" setup>
import { ref, watch, watchEffect, inject, computed, onMounted } from "vue";
import { useQuery } from "@vue/apollo-composable";
import { useDebounceFn } from "@vueuse/core";
import { editingMediaVar, inquiryVar } from "apollo";
import { MEDIA_PAGE_TOOLBAR_QUERY } from "services/graphql/mediaList";
import { capitalize, getSharedAuth } from "utils/common";
import Navbar from "../Navbar.vue";
import dayjs, { type Dayjs } from "@utils/dayjs";
import { useUserStore } from "@stores/pinia/user";
import { storeToRefs } from "pinia";

const { result: response, loading } = useQuery(MEDIA_PAGE_TOOLBAR_QUERY, null, {
  fetchPolicy: "cache-and-network",
});
const { isAdmin } = storeToRefs(useUserStore());
const result = computed(() => response?.value);

const sharedAuth = getSharedAuth();

const name = ref("");
const owners = ref(sharedAuth && sharedAuth.username ? [sharedAuth.username] : []);
const types = ref([]);
const stages = ref([]);
const tags = ref([]);
const dates = ref<[Dayjs, Dayjs] | undefined>();
const dormant = ref(false);

const ranges = [
  {
    label: "Today",
    value: [dayjs(), dayjs()],
  },
  {
    label: "Yesterday",
    value: [dayjs().add(-1, "d"), dayjs().add(-1, "d")],
  },
  {
    label: "Last 7 days",
    value: [dayjs().add(-7, "d"), dayjs()],
  },
  {
    label: "Last month",
    value: [dayjs().add(-1, "month"), dayjs()],
  },
  {
    label: "This year",
    value: [dayjs().startOf("year"), dayjs()],
  },
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
    dormant: dormant.value,
  });
});
watch(
  name,
  useDebounceFn(() => {
    updateInquiry({ name: name.value });
  }, 500),
);

const onRangeChange = (_dates: null | (Dayjs | null)[], _dateStrings: string[]) => {
  updateInquiry({
    createdBetween: _dates
      ? [_dates[0]?.format("YYYY-MM-DD"), _dates[1]?.format("YYYY-MM-DD")]
      : undefined,
  });
};

onMounted(() => {
  updateInquiry({
    createdBetween: undefined,
  });
});

const clearFilters = () => {
  name.value = "";
  owners.value = [];
  types.value = [];
  stages.value = [];
  tags.value = [];
  dates.value = undefined;
  dormant.value = false;
};
const hasFilter = computed(
  () =>
    name.value ||
    owners.value.length ||
    types.value.length ||
    stages.value.length ||
    tags.value.length ||
    dates.value ||
    dormant.value,
);
const handleFilterOwnerName = (keyword: string, option: any) => {
  const s = keyword.toLowerCase();
  return option.value.toLowerCase().includes(s) || option.label.toLowerCase().includes(s);
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
};
</script>

<template>
  <a-affix :offset-top="0">
    <div class="shadow rounded-xl px-4 py-2 bg-white flex justify-between items-center w-full">
      <a-space class="flex-wrap">
        <a-button v-if="composingMode" type="primary" danger @click="composingMode = false">
          <template #icon>
            <RollbackOutlined />
          </template>
          Back to editing
        </a-button>
        <a-button
          v-else
          type="primary"
          @click="
            visibleDropzone = true;
            onVisibleDropzone();
          "
        >
          <PlusOutlined /> {{ $t("new") }} {{ $t("media") }}
        </a-button>
        <a-input-search v-model:value="name" allow-clear class="w-48" placeholder="Search media" />
        <a-select
          v-model:value="owners"
          allow-clear
          show-arrow
          :filter-option="handleFilterOwnerName"
          mode="tags"
          style="min-width: 124px"
          placeholder="Owners"
          :loading="loading"
          :options="
            result
              ? result.users.map((e: any) => ({
                  value: e.username,
                  label: e.displayName || e.username,
                }))
              : []
          "
        >
          <template #dropdownRender="{ menuNode: menu }">
            <VNodes :vnodes="menu" />
            <a-divider style="margin: 4px 0" />
            <div
              class="w-full cursor-pointer text-center"
              @mousedown.prevent
              @click.stop.prevent="owners = []"
            >
              <team-outlined />&nbsp;All players
            </div>
          </template>
        </a-select>
        <a-select
          v-model:value="types"
          allow-clear
          show-arrow
          filter-option
          mode="tags"
          style="min-width: 128px"
          placeholder="Media types"
          :loading="loading"
          :options="
            result
              ? result.mediaTypes
                  .filter((e: any) => !['shape', 'media'].includes(e.name.toLowerCase()))
                  .map((e: any) => ({
                    value: e.name,
                    label: capitalize(e.name),
                  }))
              : []
          "
        >
        </a-select>
        <a-select
          v-model:value="stages"
          allow-clear
          show-arrow
          :filter-option="handleFilterStageName"
          mode="tags"
          style="min-width: 160px"
          placeholder="Stages assigned"
          :loading="loading"
          :options="
            result
              ? result.getAllStages.map((e: any) => ({
                  value: e.id,
                  label: e.name,
                }))
              : []
          "
        >
        </a-select>
        <a-select
          v-model:value="tags"
          allow-clear
          show-arrow
          mode="tags"
          style="min-width: 160px"
          placeholder="Tags"
          :loading="loading"
          :options="
            result
              ? result.tags.map((e: any) => ({
                  value: e.name,
                  label: e.name,
                }))
              : []
          "
        ></a-select>
        <a-range-picker
          v-model:value="dates as any"
          :placeholder="['Created from', 'to date']"
          :presets="ranges as any"
          :on-change="onRangeChange as any"
        />
        <a-space v-if="isAdmin">
          <span> Dormant: </span>
          <a-switch v-model:checked="dormant" />
        </a-space>
        <a-button v-if="hasFilter" type="dashed" @click="clearFilters">
          <ClearOutlined />Clear Filters
        </a-button>
      </a-space>
      <Navbar />
    </div>
  </a-affix>
</template>
