<script setup lang="ts">
import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import { assign, get, debounce } from "lodash-es";
import { editingMediaVar } from "apollo";
import Modal from "components/Modal.vue";
import Loading from "components/Loading.vue";
import Asset from "components/Asset.vue";
import { computed, provide, reactive, inject, watch, ref } from "vue";
import type { Ref } from "vue";
import { capitalize, compareByLabel } from "utils/common";
import { stageGraph } from "services/graphql";
import { useQuery } from "services/graphql/composable";
import MediaForm from "components/media/MediaForm/index.vue";
import VNodes from "./VNodes";
import StageMediaTable from "./StageMediaTable.vue";
import { useQuery as useApolloQuery } from "@vue/apollo-composable";
import { gql } from "@apollo/client/core";
import { permissionFragment } from "models/fragment";

dayjs.extend(isBetween);

defineProps<{
  modelValue?: string | Record<string, any>;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const { data, loading } = useQuery(stageGraph.getSearchOption);
provide("whoami", null);
// Provided by the Dropzone wrapper around this picker.
const visibleDropzone = inject("visibleDropzone") as Ref<boolean>;
const result = computed(() => data?.value);

const tableParams = reactive<Record<string, any>>({
  page: 1,
  limit: 10,
  cursor: undefined,
  sort: "CREATED_ON_DESC",
});

const formData = reactive<Record<string, any>>({
  name: null,
  owners: [],
  types: [],
  stages: [],
  tags: [],
  dates: [],
});

const searchInput = ref("");

const debouncedSearch = debounce((value: string) => {
  formData.name = value;
}, 2000);

watch(searchInput, (newValue) => {
  debouncedSearch(newValue);
});

const queryParams = computed(() => {
  const params: Record<string, any> = {
    ...tableParams,
    name: formData.name || undefined,
    owners: formData.owners.length ? formData.owners : undefined,
    mediaTypes: formData.types.length ? formData.types : undefined,
    stages: formData.stages.length ? formData.stages : undefined,
    tags: formData.tags.length ? formData.tags : undefined,
    createdBetween: formData.dates.length
      ? [formData.dates[0].format("YYYY-MM-DD"), formData.dates[1].format("YYYY-MM-DD")]
      : undefined,
  };

  Object.keys(params).forEach((key) => {
    if (params[key] === undefined) {
      delete params[key];
    }
  });

  return params;
});

const {
  result: mediaResult,
  loading: loadingMedia,
  refetch,
} = useApolloQuery(
  gql`
    query MediaTable(
      $page: Int
      $limit: Int
      $name: String
      $createdBetween: [Date]
      $mediaTypes: [String]
      $owners: [String]
      $stages: [ID]
      $tags: [String]
      $sort: [AssetSortEnum]
      $dormant: Boolean
    ) {
      media(
        input: {
          page: $page
          limit: $limit
          name: $name
          createdBetween: $createdBetween
          mediaTypes: $mediaTypes
          owners: $owners
          stages: $stages
          tags: $tags
          sort: $sort
          dormant: $dormant
        }
      ) {
        totalCount
        edges {
          id
          name
          createdOn
          size
          description
          fileLocation
          dormant
          assetType {
            name
          }
          permissions {
            ...permissionFragment
          }
          copyrightLevel
          tags
          owner {
            username
            displayName
          }
          stages {
            name
            fileLocation
            id
          }
          privilege
        }
      }
    }
    ${permissionFragment}
  `,
  queryParams,
  { notifyOnNetworkStatusChange: true },
);

watch(
  queryParams,
  () => {
    refetch();
  },
  { deep: true },
);

watch(visibleDropzone, (visible) => {
  if (visible) {
    refetch();
  }
});

const onVisibleDropzone = () => {
  editingMediaVar(undefined);
};

const select = (item: any, closeModal: () => void) => {
  emit("update:modelValue", item.src || item.fileLocation);
  closeModal();
};

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

const hasFilter = computed(() => {
  return (
    formData.name ||
    formData.owners.length > 0 ||
    formData.types.length > 0 ||
    formData.stages.length > 0 ||
    formData.tags.length > 0 ||
    formData.dates.length > 0
  );
});

const availableImages = computed(() => {
  if (!mediaResult.value?.media?.edges) return [];

  return mediaResult.value.media.edges
    .filter((media: any) => !["audio", "video"].includes(get(media, "assetType.name")))
    .filter((media: any) => ![0, 3, 4].includes(media.privilege))
    .map((media: any) => ({
      ...media,
      src: media.fileLocation,
    }));
});

const totalCount = computed(() => {
  return mediaResult.value?.media?.totalCount || 0;
});

const paginationConfig = computed(() => ({
  current: tableParams.page,
  pageSize: tableParams.limit,
  total: totalCount.value,
  showQuickJumper: true,
  showSizeChanger: true,
}));

const handleTableChange = ({ current = 1, pageSize = 10, sorter }: any) => {
  Object.assign(tableParams, {
    page: current,
    limit: pageSize,
  });

  if (sorter && !Array.isArray(sorter)) {
    sorter = [sorter];
  }

  if (sorter && sorter.length > 0) {
    const sortOrder = sorter
      .filter((s: any) => s.order)
      .map(({ columnKey, order }: any) => {
        // Keys must match the backend AssetSortEnum fields exactly
        // (asset.py sort_field_map), otherwise the sort is silently
        // dropped — previously this sent ASSET_TYPE / OWNER, which the
        // backend does not recognise (it expects ASSET_TYPE_ID / OWNER_ID).
        const fieldMap: Record<string, string> = {
          name: "NAME",
          asset_type_id: "ASSET_TYPE_ID",
          owner_id: "OWNER_ID",
          copyrightLevel: "COPYRIGHT_LEVEL",
          size: "SIZE",
          created_on: "CREATED_ON",
        };
        const field = fieldMap[columnKey] || columnKey.toUpperCase();
        return `${field}_${order === "ascend" ? "ASC" : "DESC"}`;
      });

    if (sortOrder.length > 0) {
      tableParams.sort = sortOrder;
    }
  }
};

provide("refresh", () => {
  refetch();
});

const handleFilterOwnerName = (keyword: string, option: any) => {
  const s = keyword.toLowerCase();
  return option.value.toLowerCase().includes(s) || option.label.toLowerCase().includes(s);
};

const handleFilterStageName = (keyword: string, option: any) => {
  return option.label.toLowerCase().includes(keyword.toLowerCase());
};

const clearFilters = () => {
  assign(formData, {
    name: null,
    owners: [],
    types: [],
    stages: [],
    tags: [],
    dates: [],
  });

  searchInput.value = "";

  tableParams.page = 1;
};
</script>

<template>
  <Modal :styles="{ zIndex: `999 !important` }">
    <template #trigger>
      <Asset
        v-if="modelValue"
        class="clickable"
        :asset="{
          src: modelValue,
        }"
      />
      <button v-else class="button">{{ $t("choose_an_image") }}</button>
    </template>
    <template #header
      ><span>{{ $t("choose_an_existing_image_or_upload_new") }}</span></template
    >
    <template #content="{ closeModal }">
      <Loading v-if="loadingMedia" />
      <div v-else class="columns is-multiline">
        <div class="column is-12">
          <div class="columns">
            <a-space class="shadow rounded-xl px-4 py-2 bg-white flex justify-between">
              <a-space class="flex-wrap">
                <a-button
                  type="primary"
                  @click="
                    visibleDropzone = true;
                    onVisibleDropzone();
                  "
                >
                  <PlusOutlined /> {{ $t("new") }} {{ $t("media") }}
                </a-button>
                <a-input-search
                  v-model:value="searchInput"
                  allow-clear
                  class="w-48"
                  placeholder="Search media"
                />
                <a-select
                  v-model:value="formData.owners"
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
                          .map((e: any) => {
                            return {
                              value: e.username,
                              label: e.displayName || e.username,
                            };
                          })
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
                      @click.stop.prevent="formData.owners = []"
                    >
                      <team-outlined />&nbsp;All players
                    </div>
                  </template>
                </a-select>
                <a-select
                  v-model:value="formData.types"
                  allow-clear
                  show-arrow
                  filter-option
                  mode="multiple"
                  style="min-width: 128px"
                  placeholder="Media types"
                  :loading="loading"
                  :options="
                    result
                      ? result.mediaTypes
                          .filter(
                            (e: any) => !['shape', 'media', 'image'].includes(e.name.toLowerCase()),
                          )
                          .map((e: any) => ({
                            value: e.name,
                            label: capitalize(e.name),
                          }))
                          .sort(compareByLabel)
                      : []
                  "
                >
                </a-select>
                <a-select
                  v-model:value="formData.stages"
                  allow-clear
                  show-arrow
                  :filter-option="handleFilterStageName"
                  mode="multiple"
                  style="min-width: 160px"
                  placeholder="Stages assigned"
                  :loading="loading"
                  :options="
                    result
                      ? result.getAllStages
                          .map((e: any) => ({
                            value: e.id,
                            label: e.name,
                          }))
                          .sort(compareByLabel)
                      : []
                  "
                >
                </a-select>
                <a-select
                  v-model:value="formData.tags"
                  allow-clear
                  show-arrow
                  mode="multiple"
                  style="min-width: 160px"
                  placeholder="Tags"
                  :loading="loading"
                  :options="
                    result
                      ? result.tags
                          .map((e: any) => ({
                            value: e.name,
                            label: e.name,
                          }))
                          .sort(compareByLabel)
                      : []
                  "
                ></a-select>
                <a-range-picker
                  v-model:value="formData.dates"
                  :placeholder="['Created from', 'to date']"
                  :presets="ranges"
                  :popup-style="{ zIndex: 5000 }"
                />
                <a-button v-if="hasFilter" type="dashed" @click="clearFilters">
                  <ClearOutlined />Clear Filters
                </a-button>
              </a-space>
            </a-space>
          </div>
        </div>

        <StageMediaTable
          :data="availableImages"
          :loading="loadingMedia"
          :pagination="paginationConfig"
          :total-count="totalCount"
          view-detail-action="select"
          @view-detail="(item) => select(item, closeModal)"
          @change="handleTableChange"
        />
      </div>
    </template>
  </Modal>
  <MediaForm />
</template>

<style>
.modal-card-title {
  margin-bottom: 0px;
}

.modal-card {
  border-top: none;
}

.dropdown .button {
  width: 95%;
}

.dropdown-content {
  margin-left: 1%;
}

.gallery {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-gap: 1.5rem;
}

.gallery .card-image {
  display: flex;
  justify-content: center;
}

.gallery img {
  height: 10vw;
  width: auto;
}

.uploadbtn {
  flex-grow: 0;
}
</style>
