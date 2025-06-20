<template>
  <Modal id="tos-modal">
    <template #trigger>
      <a>{{ $t("tos.terms_of_service") }}</a>
    </template>
    <template #header>{{ $t("tos.terms_of_service") }}</template>
    <template #content>
      <iframe :src="url" />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Modal from "components/Modal.vue";
import { useConfigStore } from "store/modules/config";
import { storeToRefs } from "pinia";

const configStore = useConfigStore();
const { termsOfService: url } = storeToRefs(configStore);
</script>

<style lang="scss">
#tos-modal {
  .modal-card-title {
    margin-bottom: 0 !important;
  }

  .modal-card-body {
    padding: 0;
    display: flex;
  }

  iframe {
    width: 100%;
    height: 80vh;
  }
}
</style>
