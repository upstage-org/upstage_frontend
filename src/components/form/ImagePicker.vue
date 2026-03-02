<template>
  <modal :styles="{ zIndex: `999 !important` }">
    <template #trigger>
      <Asset class="clickable" v-if="modelValue" :asset="{
        src: modelValue,
      }" />
      <button v-else class="button">{{ $t("choose_an_image") }}</button>
    </template>
    <template #header><span>{{
      $t("choose_an_existing_image_or_upload_new")
        }}</span></template>
    <template #content="{ closeModal }">
      <Loading v-if="loadingMedia" />
      <div v-else class="columns is-multiline">
        <div class="column is-12">
          <div class="columns">
            <a-space class="shadow rounded-xl px-4 py-2 bg-white flex justify-between">
              <a-space class="flex-wrap">
                <a-button type="primary" @click="visibleDropzone = true; onVisibleDropzone()">
                  <PlusOutlined /> {{ $t("new") }} {{ $t("media") }}
                </a-button>
                <a-input-search allowClear class="w-48" placeholder="Search media" v-model:value="searchInput" />
                <a-select allowClear showArrow :filterOption="handleFilterOwnerName" mode="tags"
                  style="min-width: 124px" placeholder="Owners" :loading="loading" v-model:value="formData.owners"
                  :options="result
                    ? result.users.map((e) => {
                      return {
                        value: e.username,
                        label: e.displayName || e.username,
                      }
                    })
                    : []
                    ">
                  <template #dropdownRender="{ menuNode: menu }">
                    <v-nodes :vnodes="menu" />
                    <a-divider style="margin: 4px 0" />
                    <div class="w-full cursor-pointer text-center" @mousedown.prevent
                      @click.stop.prevent="formData.owners = []">
                      <team-outlined />&nbsp;All players
                    </div>
                  </template>
                </a-select>
                <a-select allowClear showArrow filterOption mode="tags" style="min-width: 128px"
                  placeholder="Media types" :loading="loading" v-model:value="formData.types" :options="result
                    ? result.mediaTypes
                      .filter(
                        (e) =>
                          !['shape', 'media'].includes(e.name.toLowerCase()),
                      )
                      .map((e) => ({
                        value: e.name,
                        label: capitalize(e.name),
                      }))
                    : []
                    ">
                </a-select>
                <a-select allowClear showArrow :filterOption="handleFilterStageName" mode="tags"
                  style="min-width: 160px" placeholder="Stages assigned" :loading="loading"
                  v-model:value="formData.stages" :options="result
                    ? result.getAllStages.map((e) => ({
                      value: e.id,
                      label: e.name,
                    }))
                    : []
                    ">
                </a-select>
                <a-select allowClear showArrow mode="tags" style="min-width: 160px" placeholder="Tags"
                  :loading="loading" v-model:value="formData.tags" :options="result
                    ? result.tags.map((e) => ({
                      value: e.name,
                      label: e.name,
                    }))
                    : []
                    "></a-select>
                <a-range-picker :placeholder="['Created from', 'to date']" :presets="ranges"
                  v-model:value="formData.dates" :popupStyle="{ zIndex: 5000 }" />
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
          :totalCount="totalCount"
          view-detail-action="select"
          @viewDetail="(item) => select(item, closeModal)" 
          @change="handleTableChange" 
        />
      </div>
    </template>
  </modal>
  <MediaForm />
</template>

<script lang="ts">
// @ts-nocheck
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween'
import { assign, get, debounce } from 'lodash';
import { editingMediaVar } from "apollo";
import Modal from "components/Modal.vue";
import Loading from "components/Loading.vue";
import Asset from "components/Asset.vue";
import { computed, provide, reactive, inject, watch, ref } from "vue";
import { capitalize } from "utils/common";
import Dropdown from "./Dropdown.vue";
import { stageGraph } from "services/graphql";
import { useQuery } from "services/graphql/composable";
import MediaUpload from "./Media/MediaUpload.vue";
import MediaForm from 'components/media/MediaForm/index.vue';
import VNodes from './VNodes';
import StageMediaTable from './StageMediaTable.vue';
import { useQuery as useApolloQuery } from "@vue3-apollo/core";
import gql from "graphql-tag";
import { permissionFragment } from "models/fragment";

dayjs.extend(isBetween);

export default {
  props: ["modelValue"],
  emits: ["update:modelValue"],
  components: { Modal, Loading, Asset, Dropdown, MediaUpload, VNodes, MediaForm, StageMediaTable },
  setup: (props, { emit }) => {
    const { data, loading } = useQuery(stageGraph.getSearchOption);
    provide("whoami", null);
    const visibleDropzone = inject("visibleDropzone");
    const result = computed(() => data?.value);

    const tableParams = reactive({
      page: 1,
      limit: 10,
      cursor: undefined,
      sort: "CREATED_ON_DESC",
    });

    const formData = reactive({
      name: null,
      owners: [],
      types: [],
      stages: [],
      tags: [],
      dates: [],
    });

    const searchInput = ref('');
    
    const debouncedSearch = debounce((value) => {
      formData.name = value;
    }, 2000);

    watch(searchInput, (newValue) => {
      debouncedSearch(newValue);
    });

    const queryParams = computed(() => {
      const params = {
        ...tableParams,
        name: formData.name || undefined,
        owners: formData.owners.length ? formData.owners : undefined,
        mediaTypes: formData.types.length ? formData.types : undefined,
        stages: formData.stages.length ? formData.stages : undefined,
        tags: formData.tags.length ? formData.tags : undefined,
        createdBetween: formData.dates.length ? [
          formData.dates[0].format('YYYY-MM-DD'),
          formData.dates[1].format('YYYY-MM-DD')
        ] : undefined,
      };
      
      Object.keys(params).forEach(key => {
        if (params[key] === undefined) {
          delete params[key];
        }
      });
      
      return params;
    });

    const { result: mediaResult, loading: loadingMedia, fetchMore, refetch } = useApolloQuery(
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
          media(input:{
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
          }) {
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
      { notifyOnNetworkStatusChange: true } as any
    );

    watch(queryParams, () => {
      refetch();
    }, { deep: true });

    watch(visibleDropzone, (visible) => {
      if (visible) {
        refetch();
      }
    });

    const onVisibleDropzone = () => {
      editingMediaVar(undefined);
    };

    const select = (item, closeModal) => {
      emit("update:modelValue", item.src || item.fileLocation);
      closeModal();
    };

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

    const hasFilter = computed(() => {
      return formData.name || 
             formData.owners.length > 0 || 
             formData.types.length > 0 || 
             formData.stages.length > 0 || 
             formData.tags.length > 0 || 
             formData.dates.length > 0;
    });

    const availableImages = computed(() => {
      if (!mediaResult.value?.media?.edges) return [];
      
      return mediaResult.value.media.edges
        .filter(media => !["audio", "video"].includes(get(media, "assetType.name")))
        .filter(media => ![0, 3, 4].includes(media.privilege))
        .map(media => ({
          ...media,
          src: media.fileLocation
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

    const handleTableChange = ({ current = 1, pageSize = 10, sorter }) => {
      Object.assign(tableParams, {
        page: current,
        limit: pageSize,
      });

      if (sorter && !Array.isArray(sorter)) {
        sorter = [sorter];
      }
      
      if (sorter && sorter.length > 0) {
        const sortOrder = sorter
          .filter(s => s.order)
          .map(({ columnKey, order }) => {
            const fieldMap = {
              'name': 'NAME',
              'asset_type_id': 'ASSET_TYPE',
              'owner_id': 'OWNER',
              'copyrightLevel': 'COPYRIGHT_LEVEL',
              'size': 'SIZE',
              'created_on': 'CREATED_ON'
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

    const handleFilterOwnerName = (keyword, option) => {
      const s = keyword.toLowerCase();
      return (
        option.value.toLowerCase().includes(s) ||
        option.label.toLowerCase().includes(s)
      );
    };

    const handleFilterStageName = (keyword, option) => {
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
      
      searchInput.value = '';
      
      tableParams.page = 1;
    };

    return {
      loading,
      loadingMedia,
      dayjs,
      ranges,
      availableImages,
      totalCount,
      select,
      hasFilter,
      formData,
      searchInput,
      result,
      capitalize,
      visibleDropzone,
      onVisibleDropzone,
      clearFilters,
      handleFilterOwnerName,
      handleFilterStageName,
      paginationConfig,
      handleTableChange,
    };
  },
};
</script>

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