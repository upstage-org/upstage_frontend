<script lang="ts" setup>
import { useQuery } from "@vue/apollo-composable";
import { gql } from "@apollo/client/core";
import { absolutePath } from "utils/common";
import {
  useConfirmPermission,
  useDismissNotification,
} from "components/media/MediaForm/composable";
import { inquiryVar } from "apollo";
import { Media } from "models/studio";
import { computed, watch } from "vue";
import { CloseOutlined } from "@ant-design/icons-vue";

// NotificationType values mirror
// upstage_backend.assets.db_models.asset_usage.NotificationType.
// Kept inline (not a shared TS enum) because there's exactly one
// consumer and the values are unlikely to drift.
const TYPE_MEDIA_USAGE = 1; // pending strict request, owner-side
const TYPE_PERMISSION_APPROVED = 2; // approval result, requester-side
const TYPE_MEDIA_ACKNOWLEDGEMENT = 3; // acknowledgement FYI, owner-side

const { result, loading, refetch } = useQuery(
  gql`
    query Notifications {
      notifications {
        type
        mediaUsage {
          id
          userId
          assetId
          approved
          ownerSeen
          requesterSeen
          createdOn
          note
          user {
            username
            displayName
          }
          asset {
            name
            src
            fileLocation
          }
        }
      }
    }
  `,
  null,
  // Poll every 30s so the bell badge reflects new pending permission
  // requests / approvals / acknowledgements without requiring a full
  // page reload. The backend resolver is two indexed SQL selects
  // keyed on the current user, so the cost of polling is negligible.
  { pollInterval: 30_000 },
);

const { result: editingMediaResult } = useQuery<{ editingMedia: Media }>(gql`
  {
    editingMedia @client
  }
`);

watch(editingMediaResult, () => {
  if (editingMediaResult.value) {
    const { editingMedia } = editingMediaResult.value;
    if (editingMedia && editingMedia.permissions) refetch();
  }
});

const notifications = computed(() => result.value?.notifications || []);
const { mutate: confirmPermission } = useConfirmPermission();
const { mutate: dismissNotification } = useDismissNotification();
const refresh = () => {
  refetch();
  inquiryVar({
    ...inquiryVar(),
    refresh: new Date(),
  });
};
</script>

<template>
  <a-popover title="Notifications" trigger="click">
    <template #content>
      <a-list class="w-96 overflow-auto" style="max-height: 75vh">
        <a-list-item v-for="(notification, i) in notifications" :key="i" class="px-4">
          <!--
            Pending strict permission request — owner side.
            Owner clears it by approving/rejecting; no dismiss button
            because acting on the row is the dismissal.
          -->
          <template v-if="notification.type === TYPE_MEDIA_USAGE">
            <a-list-item-meta>
              <template #avatar>
                <a-avatar
                  class="my-2"
                  :src="absolutePath(notification.mediaUsage.asset.fileLocation)"
                />
              </template>
              <template #title>
                <div class="text-sm whitespace-pre-wrap mb-2">
                  <b>
                    <DName :user="notification.mediaUsage.user" />
                  </b>
                  is requesting access to your media
                  <b>{{ notification.mediaUsage.asset.name }}</b>
                  :
                  <em>&quot;{{ notification.mediaUsage.note }}&quot;</em>
                  <br />
                </div>
                <a-space>
                  <smart-button
                    type="primary"
                    :action="
                      () =>
                        confirmPermission({
                          approved: true,
                          id: notification.mediaUsage.id,
                        }).then(refresh)
                    "
                    >{{ $t("approve") }}</smart-button
                  >
                  <smart-button
                    type="danger"
                    :action="
                      () =>
                        confirmPermission({
                          approved: false,
                          id: notification.mediaUsage.id,
                        }).then(refresh)
                    "
                    >{{ $t("reject") }}</smart-button
                  >
                </a-space>
              </template>
              <template #description>
                <d-date :value="notification.mediaUsage.createdOn" />
              </template>
            </a-list-item-meta>
          </template>

          <!--
            Strict permission approved — requester side. The user
            already has access at this point; this is purely an
            in-platform heads-up so they don't have to refresh email.
            Small "x" dismiss button (icon-only) flips requester_seen.
          -->
          <template v-else-if="notification.type === TYPE_PERMISSION_APPROVED">
            <a-list-item-meta>
              <template #avatar>
                <a-avatar
                  class="my-2"
                  :src="absolutePath(notification.mediaUsage.asset.fileLocation)"
                />
              </template>
              <template #title>
                <div class="text-sm whitespace-pre-wrap mb-2 flex items-start">
                  <div class="flex-1">
                    Your request to use
                    <b>{{ notification.mediaUsage.asset.name }}</b>
                    has been approved.
                    <template v-if="notification.mediaUsage.note">
                      <br />
                      <em>&quot;{{ notification.mediaUsage.note }}&quot;</em>
                    </template>
                  </div>
                  <a-button
                    type="text"
                    size="small"
                    class="ml-2 flex-shrink-0"
                    :title="$t('dismiss') || 'Dismiss'"
                    @click="
                      dismissNotification({
                        id: notification.mediaUsage.id,
                      }).then(refresh)
                    "
                  >
                    <CloseOutlined />
                  </a-button>
                </div>
              </template>
              <template #description>
                <d-date :value="notification.mediaUsage.createdOn" />
              </template>
            </a-list-item-meta>
          </template>

          <!--
            Acknowledgement of use — owner side, FYI only.
            No approve/reject (non-strict copyright). Small "x"
            dismiss button flips owner_seen.
          -->
          <template v-else-if="notification.type === TYPE_MEDIA_ACKNOWLEDGEMENT">
            <a-list-item-meta>
              <template #avatar>
                <a-avatar
                  class="my-2"
                  :src="absolutePath(notification.mediaUsage.asset.fileLocation)"
                />
              </template>
              <template #title>
                <div class="text-sm whitespace-pre-wrap mb-2 flex items-start">
                  <div class="flex-1">
                    <b>
                      <DName :user="notification.mediaUsage.user" />
                    </b>
                    is using your media
                    <b>{{ notification.mediaUsage.asset.name }}</b
                    >.
                    <template v-if="notification.mediaUsage.note">
                      <br />
                      <em>&quot;{{ notification.mediaUsage.note }}&quot;</em>
                    </template>
                  </div>
                  <a-button
                    type="text"
                    size="small"
                    class="ml-2 flex-shrink-0"
                    :title="$t('dismiss') || 'Dismiss'"
                    @click="
                      dismissNotification({
                        id: notification.mediaUsage.id,
                      }).then(refresh)
                    "
                  >
                    <CloseOutlined />
                  </a-button>
                </div>
              </template>
              <template #description>
                <d-date :value="notification.mediaUsage.createdOn" />
              </template>
            </a-list-item-meta>
          </template>
        </a-list-item>
      </a-list>
    </template>
    <a-badge :count="notifications.length" class="relative top-1">
      <a-button type="text">
        <a-spin v-if="loading" />
        <NotificationFilled v-else />
      </a-button>
    </a-badge>
  </a-popover>
</template>
