<script setup lang="ts">
import { useQuery } from "@vue/apollo-composable";
import { message, Modal } from "ant-design-vue";
import { SelectValue } from "ant-design-vue/lib/select";
import { TransferItem } from "ant-design-vue/lib/transfer";
import { gql } from "@apollo/client/core";
import { ref, watchEffect, PropType, inject, ComputedRef, watch } from "vue";
import { editingMediaVar } from "apollo";
import configs from "config";
import { compareByLabel } from "utils/common";
import { Media, StudioGraph } from "models/studio";
import { useConfirmPermission } from "./composable";

const props = defineProps({
  modelValue: {
    type: Number,
    default: 0,
  },
  users: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  media: Object as PropType<Media>,
  note: {
    type: String,
  },
  owner: {
    type: String,
  },
});
const emits = defineEmits(["update:modelValue", "update:users", "update:owner", "update:note"]);

const copyrightLevel = ref();
const targetKeys = ref();
watchEffect(() => {
  copyrightLevel.value = props.modelValue;
  targetKeys.value = props.users;
});

watchEffect(() => {
  emits("update:modelValue", copyrightLevel.value);
  emits("update:users", targetKeys.value);
});

const { result } = useQuery<StudioGraph>(
  gql`
    {
      users(active: true) {
        id
        displayName
        username
      }
    }
  `,
  null,
  { fetchPolicy: "cache-only" },
);

const filterOption = (keyword: string, option: any) => {
  const s = keyword.toLowerCase();
  return option.value.toLowerCase().includes(s) || option.label.toLowerCase().includes(s);
};

const renderItem = (item: TransferItem) => item.displayName || item.username;

const { mutate: confirmPermission } = useConfirmPermission();
const confirm = (id: string, approved: boolean) =>
  confirmPermission({ id, approved }).then((result) => {
    if (result?.data?.confirmPermission.success) {
      message.success("Permission updated successfully!");
      editingMediaVar({
        ...editingMediaVar()!,
        permissions: result.data.confirmPermission.permissions,
      });
    }
  });
const isAdmin = inject("isAdmin") as ComputedRef<boolean>;
const handleOwnerChange = (newOwner: SelectValue) => {
  Modal.confirm({
    title: "Are you sure you want to change the owner of this media?",
    content:
      "You won't see this media in your default studio view anymore. The owner can then edit the media and delete it, or change the permisison level so that you might not be able to use it again!",
    okText: "Yes, I know what I'm doing",
    onOk: () => {
      emits("update:owner", newOwner);
    },
  });
};
watch(isAdmin, console.log);
</script>

<template>
  <a-space direction="vertical" class="w-full mb-4">
    <div v-if="isAdmin">
      👑 Owner:
      <a-select
        :options="
          result
            ? (result.users
                .map((e: any) => ({
                  value: e.username,
                  label: e.displayName || e.username,
                }))
                .sort(compareByLabel) as any)
            : []
        "
        style="min-width: 124px"
        :value="owner"
        @change="handleOwnerChange"
      />
    </div>
    <a-select v-model:value="copyrightLevel" class="w-80" placeholder="Media copyright level">
      <a-select-option
        v-for="level in configs.MEDIA_COPYRIGHT_LEVELS"
        :key="level.value"
        :value="level.value"
      >
        <span>{{ level.name }}</span>
        <span>
          <a-tooltip placement="right">
            <template #title>{{ level.description }}</template>
            <QuestionCircleOutlined class="float-right relative top-1" />
          </a-tooltip>
        </span>
      </a-select-option>
    </a-select>
    <a-tooltip title="Notes">
      <a-textarea
        placeholder="Add notes regarding acknowledgement, credits and permissions for other players who may want to use this media."
        :value="note"
        @change="$emit('update:note', $event.target.value)"
      ></a-textarea>
    </a-tooltip>
    <div
      v-if="copyrightLevel === 1 && media?.permissions?.length"
      class="media-permissions-requests"
    >
      <a-alert v-for="request in media?.permissions" :key="request.id" show-icon class="bg-white">
        <template #icon>✅</template>
        <template #message>
          <b>
            <DName :user="request.user" />
          </b>
          acknowledges use of this media.
          <small class="text-gray-500">
            <d-date :value="request.createdOn" />
          </small>
        </template>
      </a-alert>
    </div>
    <template v-else-if="copyrightLevel === 2">
      <div v-if="media?.permissions?.some((p) => !p.approved)" class="media-permissions-requests">
        <a-alert
          v-for="request in media?.permissions.filter((p) => !p.approved)"
          :key="request.id"
          type="warning"
          show-icon
        >
          <template #icon>🔑</template>
          <template #message>
            <b>
              <DName :user="request.user" />
            </b>
            is requesting access to this media: &quot;{{ request.note }}&quot;
            <br />
            <a-space>
              <smart-button type="primary" :action="() => confirm(request.id, true)">{{
                $t("approve")
              }}</smart-button>
              <smart-button type="danger" :action="() => confirm(request.id, false)">{{
                $t("reject")
              }}</smart-button>
            </a-space>
            <br />
            <small class="text-gray-500">
              <d-date :value="request.createdOn" />
            </small>
          </template>
        </a-alert>
      </div>
      <div class="upstage-transfer--sorter-arrows">
        <a-transfer
          v-model:target-keys="targetKeys"
          :locale="{
            itemUnit: 'player',
            itemsUnit: 'players',
            notFoundContent: 'No player available',
            searchPlaceholder: 'Search player name',
          }"
          :list-style="{
            flex: '1',
            height: '300px',
          }"
          :titles="[' available', ' granted']"
          :data-source="
            result
              ? (result.users.map((e: any) => ({
                  key: e.id,
                  ...e,
                })) as any)
              : []
          "
          show-search
          :filter-option="filterOption"
          :render="renderItem"
        />
      </div>
    </template>
  </a-space>
</template>

<style scoped>
.media-permissions-requests {
  /* Acknowledgement/request lists grow with player count; cap them like the
     stage lists so the dialog never outgrows the screen. */
  max-height: min(17.5em, 35vh);
  overflow-y: auto;
}

/* Preserve the vertical rhythm the alerts had as direct a-space children. */
.media-permissions-requests :deep(.ant-alert + .ant-alert) {
  margin-top: 8px;
}
</style>
