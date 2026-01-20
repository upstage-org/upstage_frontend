<script lang="ts" setup>
import { useMutation, useQuery } from "@vue3-apollo/core";
import gql from "graphql-tag";
import { computed, reactive, watch, provide, onMounted, ComputedRef } from "vue";
import type { Media, Stage, StudioGraph } from "models/studio";
import { absolutePath } from "utils/common";
import { ColumnType, TablePaginationConfig } from "ant-design-vue/lib/table";
import { SorterResult } from "ant-design-vue/lib/table/interface";
import { useI18n } from "vue-i18n";
import { capitalize } from "utils/common";
import { message } from "ant-design-vue";
import { FetchResult } from "@apollo/client";
import store from "store";
import PlayerAudienceCounter from "components/stage/PlayerAudienceCounter.vue";

const { t } = useI18n();
const isAdmin = computed(() => store.getters["user/isAdmin"]);
const enterStage = (stage: Stage) => {
  window.open(`/${stage.fileLocation}`, "_blank");
};
const tableParams = reactive({
  page: 1,
  limit: 10,
  sort: ["LAST_ACCESS_DESC"],
  access: []
});
const { result: inquiryResult } = useQuery(gql`
  {
    inquiry @client
  }
`);
const params = computed(() => ({
  ...tableParams,
  ...(inquiryResult.value as any)?.inquiry || {},
}));

const { result, loading, fetchMore, refetch } = useQuery(
  gql`
    query StageTable(
      $page: Int
      $limit: Int
      $name: String
      $createdBetween: [Date]
      $owners: [String]
      $sort: [StageSortEnum]
      $access: [String]
    ) {
      stages(input:{
        page: $page
        limit: $limit
        name: $name
        createdBetween: $createdBetween
        owners: $owners
        sort: $sort
        access: $access
      }) {
        totalCount
        edges {
            id
            name
            fileLocation
            status
            visibility
            cover
            description
            playerAccess
            permission
            lastAccess
            owner {
              username
              displayName
            }
            assets {
              id
              name
            }
            createdOn
        }
      }
    }
  `,
  params,
  { notifyOnNetworkStatusChange: true } as any,
);

onMounted(() => {
  refetch();
});

watch(params, () => {
  refetch();
});

const columns: ComputedRef<ColumnType<Stage>[]> = computed((): ColumnType<Stage>[] => [
  {
    title: t("preview"),
    align: "center",
    width: 96,
    key: "cover",
    dataIndex: "cover",
  },
  {
    title: t("name"),
    dataIndex: "name",
    key: "name",
    sorter: {
      multiple: 4,
    },
  },
  {
    title: t("owner"),
    dataIndex: "owner",
    key: "owner_id",
    sorter: {
      multiple: 3,
    },
  },
  {
    title: "Created",
    dataIndex: "createdOn",
    key: "created_on",
    sorter: {
      multiple: 5,
    },
    defaultSortOrder: "descend",
  },
  {
    title: t("last_access"),
    dataIndex: "lastAccess",
    key: "last_access",
    sorter: {
      multiple: 2,
    },
    //defaultSortOrder: "descend",
  },
  //    {
  //        title: t("recorded"),
  //        align: "center",
  //        key: "recording",
  //    },
  {
    title: t("status"),
    dataIndex: "status",
    key: "status",
    align: "center",
  },
  {
    title: t("visibility"),
    dataIndex: "visibility",
    key: "visibility",
    align: "center",
  },
  {
    title: t("access"),
    dataIndex: "permission",
    key: "permission",
    sorter: {
      multiple: 1,
    }
  },
  {
    title: `${t("manage")} ${t("stage")}`,
    align: "center",
    fixed: "right",
    key: "actions",
  },
]);

interface Pagination {
  current: number;
  pageSize: number;
  showQuickJumper: boolean;
  showSizeChanger: boolean;
  total: number;
}

interface Sorter {
  column: any;
  columnKey: string;
  field: string;
  order: "ascend" | "descend";
}

const handleTableChange = (
  { current = 1, pageSize = 10 }: TablePaginationConfig,
  _: any,
  sorter: SorterResult<Media> | SorterResult<Media>[],
) => {
  const sort = (Array.isArray(sorter) ? sorter : [sorter])
    .sort(
      (a, b) =>
        (a.column?.sorter as any).multiple - (b.column?.sorter as any).multiple,
    )
    .map(({ columnKey, order }) =>
      `${columnKey == "permission" ? "access" : columnKey}_${order === "ascend" ? "ASC" : "DESC"}`.toUpperCase(),
    );

  Object.assign(tableParams, {
    page: current,
    limit: pageSize,
    sort,
  });
};
const dataSource = computed(() => {
  return (result.value as any) ? (result.value as any).stages.edges : []
});

provide("refresh", () => {
  refetch();
});

const {
  mutate: updateStatus,
  loading: loadingUpdateStatus,
  onDone: onStatusUpdated,
} = useMutation<{ updateStatus: { result: string } }, { id: string }>(gql`
  mutation UpdateStatus($id: ID!) {
    updateStatus(id: $id) {
      result
    }
  }
`);
const handleChangeStatus = async (record: Stage) => {
  await updateStatus({
    id: record.id,
  });
};

const {
  mutate: updateVisibility,
  loading: loadingUpdateVisibility,
  onDone: onVisibilityUpdated,
} = useMutation<{ updateVisibility: { result: string } }, { id: string }>(
  gql`
    mutation UpdateVisibility($id: ID!) {
      updateVisibility(id: $id) {
        result
      }
    }
  `,
);
const handleChangeVisibility = async (record: Stage) => {
  await updateVisibility({
    id: record.id,
  });
};

const handleUpdate = (data: any) => {
  if (data?.updateStatus || data?.updateVisibility) {
    message.success("Stage updated successfully!");
  } else {
    message.error("You don't have permission to perform this action!");
  }
  refetch();
};

onStatusUpdated(handleUpdate);
onVisibilityUpdated(handleUpdate);
</script>

<template>
  <a-layout class="w-full rounded-xl bg-white overflow-hidden">
    <a-table class="w-full shadow overflow-auto" :columns="columns as ColumnType<Stage>[]" :data-source="dataSource"
      rowKey="id" :loading="loading" @change="handleTableChange" :pagination="{
        showQuickJumper: true,
        showSizeChanger: true,
        total: (result as any) ? (result as any).stages.totalCount : 0,
      } as Pagination
        ">
      <template #bodyCell="{ column, record, text }">
        <template v-if="column.key === 'cover'">
          <a-image :src="text ? absolutePath(text) : '/img/greencurtain.jpg'" class="w-24 max-h-24 object-contain" />
        </template>
        <template v-if="column.key === 'owner_id'">
          <span v-if="text.displayName">
            <b>{{ text.displayName }}</b>
            <br />
            <span class="text-gray-500">{{ text.username }}</span>
          </span>
          <span v-else>
            <span>{{ text.username }}</span>
          </span>
        </template>
        <template v-if="['created_on', 'last_access'].includes(column.key as string)">
          <div style="text-align: center;">
            <d-date v-if="text" :value="text" />
            <br />
            <PlayerAudienceCounter v-if="column.key == 'last_access'" :stage-url="record.fileLocation"
              class="counter" />
          </div>
        </template>
        <template v-if="column.key === 'permission'">
          {{ capitalize(text) }}
        </template>
        <template v-if="column.key === 'status'">
          <a-tag v-if="(record as Stage).status === 'upcoming'" color="yellow">
            {{ capitalize(text) }}
          </a-tag>
          <a-tooltip v-else :title="capitalize(text)">
            <a-switch checked-children="L" un-checked-children="R" :checked="text === 'live'"
              :loading="loadingUpdateStatus" @change="handleChangeStatus(record as Stage)" />
          </a-tooltip>
        </template>
        <template v-if="column.key === 'visibility'">
          <a-switch :checked="!!text" :loading="loadingUpdateVisibility"
            @change="handleChangeVisibility(record as Stage)" />
        </template>
        <template v-if="column.key === 'actions'">
          <a-space class="flex" style="justify-content: flex-end;">
            <router-link v-if="isAdmin || record.permission == 'editor' || record.permission == 'owner'"
              :to="`/stages/stage-management/${record.id}/`">
              <a-button>
                <setting-outlined />
                Manage
              </a-button>
            </router-link>
            <a-button type="primary" @click="enterStage(record as Stage)">
              <login-outlined />
              Enter
            </a-button>
          </a-space>
        </template>
      </template>
    </a-table>
    <slot></slot>
  </a-layout>
</template>
<style scoped>
.emptyImg {
  width: 50px;
  height: 50px;
  background-color: green;
  margin: auto;
}
</style>