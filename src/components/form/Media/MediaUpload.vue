<script>
import Modal from "components/Modal.vue";
import Upload from "components/form/Upload.vue";
import MediaModal from "./MediaModal.vue";
import { inject, ref } from "vue";

export default {
  components: { Modal, MediaModal, Upload },
  props: { special: Boolean },
  setup: () => {
    const base64 = ref();
    const active = ref();

    const media = ref();

    const getType = (fileType) => {
      if (fileType === "image") return "avatar";
      if (fileType === "audio") return "audio";
      if (fileType === "video") return "video";
    };

    const handleFileChange = async (file, type) => {
      if (file) {
        active.value = true;
        media.value = {
          name: file.name,
          base64: base64.value,
          assetType: getType(type),
          fileType: type,
          filename: file.name,
          stages: [],
          copyrightLevel: 0,
        };
      }
    };

    const refresh = inject("refresh");
    const uploadCompleted = () => {
      refresh();
      media.value = null;
    };

    return {
      active,
      base64,
      media,
      handleFileChange,
      uploadCompleted,
    };
  },
};
</script>

<template>
  <div class="dropdown is-hoverable">
    <div class="dropdown-trigger">
      <Upload v-if="!active" v-model="base64" @change="handleFileChange">
        <span>{{ $t("new") }}</span>
        <span class="icon">
          <i class="fas fa-plus"></i>
        </span>
      </Upload>
    </div>
  </div>
  <Modal v-model="active" width="100%" height="100%">
    <MediaModal v-if="media" :media="media" @complete="uploadCompleted" />
  </Modal>
</template>

<style></style>
