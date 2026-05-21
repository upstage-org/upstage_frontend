<script>
import { ref } from "vue";
import Modal from "components/Modal.vue";
import SaveButton from "components/form/SaveButton.vue";
export default {
  components: { Modal, SaveButton },
  props: {
    loading: Boolean,
    onlyYes: Boolean,
  },
  emits: ["confirm"],
  setup: () => {
    const active = ref(false);

    return { active };
  },
};
</script>

<template>
  <slot name="render" :confirm="() => (active = true)" />
  <Modal v-model="active" width="500px">
    <template #trigger>
      <slot name="trigger"></slot>
    </template>
    <template #content>
      <slot> Are you sure you want to do this? </slot>
    </template>
    <template #footer="{ closeModal }">
      <button v-if="!onlyYes" class="button is-dark" @click="active = false">
        <slot name="no">
          <span class="icon">
            <i class="fas fa-times"></i>
          </span>
          <span>{{ $t("no") }}</span>
        </slot>
      </button>
      <SaveButton class="is-dark" :loading="loading" @click="$emit('confirm', closeModal)">
        <slot name="yes">
          <span class="icon">
            <i class="fas fa-check"></i>
          </span>
          <span>{{ $t("yes") }}</span>
        </slot>
      </SaveButton>
    </template>
  </Modal>
</template>

<style></style>
