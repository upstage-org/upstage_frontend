<script setup lang="ts">
import { inject, ref, createVNode } from "vue";
import type { Ref } from "vue";
import { message } from "ant-design-vue";
import { stageGraph } from "services/graphql";
import { useClearStage } from "components/stage/composable";
import { Modal } from "ant-design-vue";
import { handleError } from "utils/common";
import { useMutation } from "services/graphql/composable";

const props = defineProps<{ archive?: boolean }>();

// Provided by StageManagement/index.vue.
const stage = inject("stage") as Ref<any>;
const refresh = inject("refresh") as ((id: unknown) => void) | undefined;
const status = ref<string>();

const { mutation } = useMutation(stageGraph.sweepStage, {
  id: stage.value.id,
});

const onConfirm = () => {
  Modal.confirm({
    title: "Confirm",
    content: createVNode(
      "div",
      { style: "color: black; white-space: pre-line;" },
      props.archive
        ? "Archiving will create a replay recording and chat files from the stage since it was last archived. It will also sweep the stage and start a new recording. Sweeping the stage removes all media items from the stage, including text and drawings. Media assigned to the stage will still be available in the toolbars, as will any scenes that have been saved.\n Do you want to archive now?"
        : "Sweeping the stage removes all media items from the stage, including text and drawings. Media assigned to the stage will still be available in the toolbars, as will any scenes that have been saved.\n Do you want to sweep the stage?",
    ),
    onOk() {
      sweep();
    },
    okButtonProps: {
      danger: true,
    },
  });
};

const sweep = async () => {
  try {
    status.value = "Sweeping archived events...";
    await mutation();
    status.value = "Send live stage sweeping signal...";

    const config = stage.value.attributes.find((i: { name: string }) => i.name === "config");

    const clearStage = useClearStage(
      stage.value.fileLocation,
      config ? JSON.parse(config.description)?.defaultcolor : null,
      stage.value.mqtt,
    );
    await clearStage();
    message.success(`${stage.value.name} swept successfully!`);
    if (refresh) {
      refresh(stage.value.id);
    }
  } catch (error) {
    handleError(error);
  } finally {
    status.value = "";
  }
};
</script>

<template>
  <button class="button ml-2 is-warning" @click="onConfirm">
    <template v-if="status">
      <button class="button is-warning is-loading"></button>
      <span>{{ status }}</span>
    </template>
    <span v-else></span>
    <slot>{{ $t("sweep_stage") }}</slot>
  </button>
</template>

<style></style>
