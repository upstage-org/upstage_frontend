<script lang="ts" setup>
import { ref, watch, watchEffect, onMounted, computed } from "vue";
import { useQuery } from "@vue/apollo-composable";
import { useDebounceFn } from "@vueuse/core";
import { gql } from "@apollo/client/core";
import { StudioGraph } from "models/studio";
import { inquiryVar } from "apollo";
import Navbar from "../Navbar.vue";
import dayjs, { type Dayjs } from "@utils/dayjs";
import { ALL_STAGE_ACCESS, DEFAULT_STAGE_ACCESS, normalizeStageAccess } from "utils/studioInquiry";
import { compareByLabel } from "utils/common";

const { result, loading } = useQuery<StudioGraph>(gql`
  query StageFilter {
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
    stages(input: {}) {
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

const name = ref("");
const owners = ref([]);
const types = ref([]);
const stages = ref([]);
const tags = ref([]);
const access = ref<string[]>([...DEFAULT_STAGE_ACCESS]);
const dates = ref<[Dayjs, Dayjs] | undefined>();

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

const accessOptions = [
  { value: "owner", label: "Owner" },
  { value: "editor", label: "Editor" },
  { value: "player", label: "Player" },
  { value: "audience", label: "Audience" },
];

const updateInquiry = (vars: any) =>
  inquiryVar({
    ...inquiryVar(),
    ...vars,
  });

const watchInquiryVar = (vars: any) => {
  if (Array.isArray(vars.mediaTypes)) {
    types.value = vars.mediaTypes;
  }
  if (Array.isArray(vars.tags)) {
    tags.value = vars.tags;
  }
  if (Array.isArray(vars.owners)) {
    owners.value = vars.owners;
  }
  if (typeof vars.name === "string") {
    name.value = vars.name;
  }
  // Only apply `access` when another writer set it; Media/Admin updates
  // often omit `access`, which previously reset this to [] and blanked the table.
  if (Object.prototype.hasOwnProperty.call(vars, "access")) {
    access.value = normalizeStageAccess(vars.access);
  }
  inquiryVar.onNextChange(watchInquiryVar);
};
inquiryVar.onNextChange(watchInquiryVar);

watchEffect(() => {
  updateInquiry({
    owners: owners.value,
    stages: stages.value,
    tags: tags.value,
    mediaTypes: types.value,
    access: normalizeStageAccess(access.value),
  });
});

onMounted(() => {
  updateInquiry({
    createdBetween: undefined,
    access: normalizeStageAccess(access.value),
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

const clearFilters = () => {
  name.value = "";
  owners.value = [];
  types.value = [];
  stages.value = [];
  tags.value = [];
  access.value = [...DEFAULT_STAGE_ACCESS];
  dates.value = undefined;
};

const hasFilter = computed(() => {
  const accessFiltered =
    access.value.length !== DEFAULT_STAGE_ACCESS.length ||
    !DEFAULT_STAGE_ACCESS.every((level) => access.value.includes(level));
  return (
    name.value ||
    owners.value.length ||
    types.value.length ||
    stages.value.length ||
    tags.value.length ||
    accessFiltered ||
    dates.value
  );
});

const handleFilterOwnerName = (keyword: string, option: any) => {
  const s = keyword.toLowerCase();
  return option.value.toLowerCase().includes(s) || option.label.toLowerCase().includes(s);
};

const VNodes = (_: any, { attrs }: { attrs: any }) => {
  return attrs.vnodes;
};
</script>

<template>
  <a-affix :offset-top="0">
    <div class="shadow rounded-xl px-4 py-2 bg-white flex justify-between items-center w-full">
      <a-space class="flex-wrap">
        <RouterLink to="/stages/new-stage">
          <a-button type="primary"> <PlusOutlined /> {{ $t("new") }} {{ $t("stage") }} </a-button>
        </RouterLink>
        <a-input-search v-model:value="name" allow-clear class="w-48" placeholder="Search stage" />
        <a-select
          v-model:value="owners"
          allow-clear
          show-arrow
          :filter-option="handleFilterOwnerName"
          mode="multiple"
          style="min-width: 124px"
          placeholder="Owners"
          :loading="loading"
          :options="
            result
              ? result.users
                  .map((e) => ({
                    value: e.username,
                    label: e.displayName || e.username,
                  }))
                  .sort(compareByLabel)
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
          v-model:value="access"
          allow-clear
          mode="multiple"
          style="min-width: 124px"
          placeholder="Access Level"
          :options="accessOptions"
        >
          <template #dropdownRender="{ menuNode: menu }">
            <VNodes :vnodes="menu" />
            <a-divider style="margin: 4px 0" />
            <div
              class="w-full cursor-pointer text-center"
              @mousedown.prevent
              @click.stop.prevent="access = [...ALL_STAGE_ACCESS]"
            >
              <unlock-outlined />&nbsp;All Access
            </div>
          </template>
        </a-select>
        <a-range-picker
          v-model:value="dates as any"
          :placeholder="['Created from', 'to date']"
          :presets="ranges as any"
          @change="onRangeChange as any"
        />
        <a-button v-if="hasFilter" type="dashed" @click="clearFilters">
          <ClearOutlined />Clear Filters
        </a-button>
      </a-space>
      <Navbar />
    </div>
  </a-affix>
</template>
