<script lang="ts" setup>
import {
  computed,
  inject,
  Ref,
  defineProps,
  defineEmits
} from "vue";
import { editingMediaVar, inquiryVar } from "apollo";
import configs from "config";
import {
  Media,
  MediaAttributes,
  UploadFile,
} from "models/studio";
import { absolutePath } from "utils/common";
import { ColumnType, TablePaginationConfig } from "ant-design-vue/lib/table";
import { SorterResult } from "ant-design-vue/lib/table/interface";
import { useI18n } from "vue-i18n";
import MediaPreview from "components/media/MediaPreview.vue";

interface Props {
  loading?: boolean;
  data?: Media[];
  pagination?: {
    current: number;
    pageSize: number;
    total: number;
    showQuickJumper: boolean;
    showSizeChanger: boolean;
  };
  totalCount?: number;
  viewDetailAction?: string;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  data: () => [],
  viewDetailAction: 'view'
});

const emit = defineEmits<{
  viewDetail: [item: Media];
  change: [params: {
    current: number;
    pageSize: number;
    sorter?: SorterResult<Media> | SorterResult<Media>[];
  }];
}>();

const { t } = useI18n();
const files = inject<Ref<UploadFile[]>>("files");

const columns = computed<ColumnType<Media>[]>(() => [
  {
    title: t("preview"),
    align: "center",
    width: 96,
    key: "preview",
  },
  {
    title: t("name"),
    dataIndex: "name",
    key: "name",
    sorter: true,
  },
  {
    title: t("type"),
    dataIndex: ["assetType", "name"],
    key: "asset_type_id",
    sorter: true,
  },
  {
    title: t("owner"),
    dataIndex: "owner",
    key: "owner_id",
    sorter: true,
  },
  {
    title: t("copyright_level"),
    dataIndex: "copyrightLevel",
    key: "copyrightLevel",
    sorter: true,
  },
  {
    title: t("stages"),
    key: "stages",
    dataIndex: "stages",
    width: 250,
  },
  {
    title: t("size"),
    dataIndex: "size",
    key: "size",
    sorter: true,
  },
  {
    title: t("date"),
    dataIndex: "createdOn",
    key: "created_on",
    sorter: true,
  },
  {
    title: `${t("manage")} ${t("media")}`,
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

const handleTableChange = (
  pagination: TablePaginationConfig,
  filters: any,
  sorter: SorterResult<Media> | SorterResult<Media>[],
) => {
  emit('change', {
    current: pagination.current || 1,
    pageSize: pagination.pageSize || 20,
    sorter
  });
};

const dataSource = computed(() => props.data || []);

const paginationConfig = computed<Pagination>(() => ({
  current: props.pagination?.current || 1,
  pageSize: props.pagination?.pageSize || 20,
  total: props.totalCount || props.pagination?.total || 0,
  showQuickJumper: props.pagination?.showQuickJumper ?? true,
  showSizeChanger: props.pagination?.showSizeChanger ?? true,
}));

const editMedia = (media: Media) => {
  editingMediaVar(media);
};

const composingMode = inject<Ref<boolean>>("composingMode");

const addFrameToEditingMedia = (media: Media) => {
  if (files && composingMode) {
    let frames = [media.fileLocation];
    const attribute = JSON.parse(media.description || "{}") as MediaAttributes;
    if (attribute.multi) {
      frames = attribute.frames;
    }
    files.value = files.value.concat(
      frames.map<UploadFile>((frame, i) => ({
        id: files.value.length + i,
        preview: absolutePath(frame),
        url: frame,
        status: "uploaded",
        file: {
          name: frame,
        } as File,
      })),
    );
    composingMode.value = false;
  }
};

const filterTag = (tag: string) => {
  inquiryVar({
    ...inquiryVar(),
    tags: [tag],
  });
};

</script>

<template>
  <a-layout class="w-full shadow rounded-xl bg-white overflow-hidden">
    <a-table 
      class="w-full overflow-auto" 
      :columns="columns as ColumnType<Media>[]" 
      :data-source="dataSource"
      rowKey="id" 
      :loading="loading" 
      @change="handleTableChange" 
      :pagination="paginationConfig"
    >
      <template #bodyCell="{ column, record, text }">
        <template v-if="column.key === 'preview'">
          <MediaPreview v-if="record.assetType" :media="record as Media" />
        </template>
        <template v-if="column.key === 'name'">
          <span>{{ text }}</span>
        </template>
        <template v-if="column.key === 'asset_type_id'">
          <span class="capitalize">{{ record.assetType.name }}</span>
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
        <template v-if="column.key === 'stages'">
          <a v-for="(stage, i) in text" :key="i" :href="`${configs.UPSTAGE_URL}/${stage.fileLocation}`" target="_blank">
            <a-tag color="#007011">{{ stage.name }}</a-tag>
          </a>
        </template>
        <template v-if="column.key === 'tags'">
          <a-tag v-for="(tag, i) in text" :key="i" :color="tag" @click="filterTag(tag)" class="cursor-pointer">{{ tag }}
          </a-tag>
        </template>
        <template v-if="column.key === 'size'">
          <a-tag v-if="text" :color="text < 100000 ? 'green' : text < 500000 ? 'gold' : 'red'">
            <d-size :value="text" />
          </a-tag>
          <a-tag v-else>{{ $t("no_size") }}</a-tag>
        </template>
        <template v-if="column.key === 'copyrightLevel'">
          <span class="leading-4">{{
            configs.MEDIA_COPYRIGHT_LEVELS.find(
              (l) => l.value === record.copyrightLevel,
            )?.name
          }}</span>
        </template>
        <template v-if="column.key === 'created_on'">
          <d-date :value="text" />
        </template>
        <template v-if="column.key === 'actions'">
          <a-space>
            <a-button type="primary" @click="emit('viewDetail', record as Media)">
              Select
            </a-button>
          </a-space>
        </template>
      </template>
    </a-table>
  </a-layout>
</template>