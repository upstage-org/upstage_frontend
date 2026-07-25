<script lang="ts" setup>
import { watch, computed } from "vue";
import { useQuery } from "@vue/apollo-composable";
import { useDebounceFn } from "@vueuse/core";
import { gql } from "@apollo/client/core";
import { StudioGraph } from "models/studio";
import { inquiryVar } from "apollo";
import Navbar from "../Navbar.vue";
import dayjs from "@utils/dayjs";
import { ALL_STAGE_ACCESS, DEFAULT_STAGE_ACCESS, buildStageInquiry } from "utils/studioInquiry";
import { compareByLabel } from "utils/common";
import { stageListFilters as filters } from "utils/stageFilterState";

const { result, loading } = useQuery<StudioGraph>(gql`
  query StageFilter {
    users(active: true) {
      id
      username
      displayName
    }
  }
`);

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

const pushInquiry = () => updateInquiry(buildStageInquiry(filters));

// Full push at setup time: the filter state lives at module scope, so this
// restores the persisted filters after Back navigation AND overwrites stale
// shared keys (name/owners/createdBetween) left in the inquiryVar by the
// Media/Player pages. StageFilter's setup runs before StageTable's, so the
// table's first fetch already uses these values.
pushInquiry();

// Structural filters apply immediately — the push includes any search text
// still inside its debounce window, so changing a filter commits the typed
// text instead of reverting it.
watch(() => [filters.owners, filters.access, filters.dates], pushInquiry);

// Typing stays debounced.
watch(() => filters.name, useDebounceFn(pushInquiry, 500));

const clearFilters = () => {
  filters.name = "";
  filters.owners = [];
  filters.access = [...DEFAULT_STAGE_ACCESS];
  filters.dates = undefined;
  // The watcher covers owners/access/dates; a name-only reset would
  // otherwise wait out the debounce.
  pushInquiry();
};

const hasFilter = computed(() => {
  const accessFiltered =
    filters.access.length !== DEFAULT_STAGE_ACCESS.length ||
    !DEFAULT_STAGE_ACCESS.every((level) => filters.access.includes(level));
  return Boolean(filters.name || filters.owners.length || accessFiltered || filters.dates);
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
        <a-input-search
          v-model:value="filters.name"
          allow-clear
          class="w-48"
          placeholder="Search name or URL"
        />
        <a-select
          v-model:value="filters.owners"
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
              @click.stop.prevent="filters.owners = []"
            >
              <team-outlined />&nbsp;All players
            </div>
          </template>
        </a-select>
        <a-select
          v-model:value="filters.access"
          allow-clear
          show-arrow
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
              @click.stop.prevent="filters.access = [...ALL_STAGE_ACCESS]"
            >
              <unlock-outlined />&nbsp;All Access
            </div>
          </template>
        </a-select>
        <a-range-picker
          v-model:value="filters.dates as any"
          :placeholder="['Created from', 'to date']"
          :presets="ranges as any"
        />
        <a-button v-if="hasFilter" type="dashed" @click="clearFilters">
          <ClearOutlined />Clear Filters
        </a-button>
      </a-space>
      <Navbar />
    </div>
  </a-affix>
</template>
