<script lang="ts" setup>
import { message } from "ant-design-vue";
import { PropType, computed, ref, inject } from "vue";
import { Media } from "models/studio";
import { absolutePath } from "utils/common";
import { useRequestPermission } from "./composable";
import { ownerNote } from "../ownerNote";

const props = defineProps({
  media: {
    type: Object as PropType<Media>,
    required: true,
  },
});

const visible = ref(false);
const note = ref("");
// The owner's own conditions (#1570), shown before the player writes theirs.
const conditions = computed(() => ownerNote(props.media));

const refresh = inject("refresh", () => {});
const { mutate, loading } = useRequestPermission();
const handleOk = async () => {
  if (!note.value.trim()) {
    message.warning("Please provide a reason!");
    return;
  }
  const response = await mutate({
    assetId: props.media.id,
    note: note.value,
  });
  if (response?.data?.requestPermission.success) {
    message.success("Permission request sent");
    visible.value = false;
    refresh();
  }
};
</script>

<template>
  <a-button type="dashed" @click="visible = true"> <SendOutlined />Request permission </a-button>
  <a-modal
    v-model:visible="visible"
    :confirm-loading="loading"
    ok-text="Send Request"
    @ok="handleOk"
  >
    You are requesting permission for
    <a-avatar class="my-2" :src="absolutePath(media.fileLocation)" />
    {{ media.name }}.
    <p v-if="conditions" class="owner-note" data-testid="owner-note">
      <b>Note from <DName :user="media.owner" />:</b>
      <br />{{ conditions }}
    </p>
    <a-textarea
      v-model:value="note"
      :placeholder="`Please write something so that ${media.owner.username} can understand your purpose of using the media.`"
      :auto-size="{ minRows: 2, maxRows: 5 }"
    />
  </a-modal>
</template>

<style scoped>
.owner-note {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid #007011;
  background: #f6fbf6;
  white-space: pre-wrap;
}
</style>
