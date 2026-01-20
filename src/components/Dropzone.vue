<script setup lang="ts">
import { ref, provide, watch, Ref, defineModel } from "vue";
import configs from "config";
import { message } from "ant-design-vue";
import { useQuery } from "@vue3-apollo/core";
import gql from "graphql-tag";
import { uploadDefault } from "models/studio";
import i18n from "../i18n";
import { humanFileSize } from "utils/common";
import {
  Media,
  StudioGraph,
  UploadFile,
} from "models/studio";

const model = defineModel()
const enabled = ref(false);
const { result: whoAmIResult, refetch: loadWhoAmI } = useQuery<StudioGraph>(
  gql`
    query WhoAmI {
      whoami {
        uploadLimit
      }
    }
  `,
  {},
  {
    enabled,
    fetchPolicy: "network-only",
  } as any,
);

const load = async () => {
  if (!enabled.value) {
    enabled.value = true;
    // Wait for the query to complete
    return new Promise<any>((resolve) => {
      const unwatch = watch(whoAmIResult, (result: any) => {
        if (result?.whoami) {
          unwatch();
          resolve({ data: { whoami: result.whoami } });
        }
      }, { immediate: true });
    });
  } else {
    const result = await loadWhoAmI();
    return (result as any) ? { data: { whoami: (result as any).whoami } } : null;
  }
};
const { result: editingMediaResult, refetch: reload } = useQuery<{ editingMedia: Media }>(gql`
  {
    editingMedia @client
  }
`);
const visible = ref(false);
const files = ref<UploadFile[]>([]);
const composingMode = ref(false);
provide("composingMode", composingMode);
provide("files", files);
provide("visibleDropzone", visible);

window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  visible.value = true;
});

const toSrc = ({ file }: { file: File }) => {
  return URL.createObjectURL(file);
};

watch(visible as Ref, (val) => {
  reload();
});

const handleUpload = async (file: UploadFile) => {
  let fileType = file.file.type;
  const profile = await load();
  const uploadLimit = (profile?.data || profile?.whoami).uploadLimit ?? uploadDefault;

  if (!fileType.includes("video")) {
    const canUpload = file.file.size <= uploadLimit;
    if (!canUpload) {
      const hide = message.error({
        content: i18n.global.t("over_limit_upload", {
          size: humanFileSize(file.file.size),
          limit: humanFileSize(uploadLimit ?? 0),
          name: file.file.name,
        }),
        duration: 0,
        onClick: () => hide(),
        class: "cursor-pointer",
      });
      return;
    }
  }
  if (editingMediaResult.value?.editingMedia?.id) {
    const { assetType } = editingMediaResult.value?.editingMedia;
    if (["video", "audio"].includes(assetType?.name) && !fileType.includes(assetType?.name) ||
      (fileType.includes("video") || fileType.includes("audio")) && !["video", "audio"].includes(assetType?.name)
    ) {
      message.error("Invalid file type!");
      return;
    }
  }
  if (model.value) {
    files.value = [{
      ...file,
      id: files.value.length,
      preview: toSrc(file),
      status: "local",
    }];

    model.value = !model.value
  } else {
    files.value = files.value.concat({
      ...file,
      id: files.value.length,
      preview: toSrc(file),
      status: "local",
    });
  }
};

const uploadFile = async (file: any) => {
  await handleUpload(file);
  visible.value = false;
};
</script>

<template>
  <a-modal :footer="null" :visible="visible" @cancel="visible = false" width="100%" wrapClassName="fullscreen-dragzone"
    class="h-full top-0 p-0">
    <a-upload-dragger :show-upload-list="false" :custom-request="uploadFile" multiple>
      <p class="ant-upload-drag-icon">
        <UploadOutlined />
      </p>
      <p class="ant-upload-text">{{ $t("upload_hint") }}</p>
      <p class="ant-upload-hint">
        {{
          $t("upload_accepted_format", {
            image: configs.ALLOWED_EXTENSIONS.IMAGE,
            audio: configs.ALLOWED_EXTENSIONS.AUDIO,
            video: configs.ALLOWED_EXTENSIONS.VIDEO,
          })
        }}
      </p>
    </a-upload-dragger>
  </a-modal>
  <slot></slot>
</template>

<style lang="less">
.fullscreen-dragzone {
  z-index: 999999 !important;

  .ant-modal {
    max-width: unset;

    .ant-modal-content {
      height: 100%;
      padding-right: 48px;
    }

    .ant-modal-body {
      padding: 0;
      height: 100%;
    }

    .ant-upload-btn {
      display: flex !important;
      flex-direction: column;
      justify-content: center;
    }
  }
}
</style>