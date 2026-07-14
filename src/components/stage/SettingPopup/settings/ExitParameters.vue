<!--
  Temporary exit-animation override for the right-clicked board object.
  Save applies via shapeObject only (in-memory + MQTT MOVE_TO broadcast);
  the persistent per-stage-assignment exit settings in the studio media
  editor are deliberately left untouched.
-->
<script>
import { computed, reactive } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import SaveButton from "components/form/SaveButton.vue";
import ExitSettings from "components/media/ExitSettings.vue";
import { DEFAULT_EXIT_ANIMATION, DEFAULT_EXIT_SPEED } from "components/stage/removalAnimations";
import { isJitsiBoardType, isStreamPlaybackBoardType } from "utils/common";

export default {
  components: {
    ExitSettings,
    SaveButton,
  },
  emits: ["close"],
  setup: (props, { emit }) => {
    const stageStore = useStageStore();
    const currentObject = computed(() => stageStore.activeObject);
    const parameters = reactive({
      exitAnimation: currentObject.value?.exitAnimation || DEFAULT_EXIT_ANIMATION,
      exitSpeed: currentObject.value?.exitSpeed || DEFAULT_EXIT_SPEED,
    });

    // Live tiles have no poster image; ExitSettings falls back to its
    // placeholder circle when previewSrc is absent.
    const previewSrc = computed(() => {
      const object = currentObject.value;
      if (!object?.src) return undefined;
      if (
        isStreamPlaybackBoardType(object.type) ||
        isStreamPlaybackBoardType(object.assetType?.name) ||
        isJitsiBoardType(object.type)
      ) {
        return undefined;
      }
      return object.src;
    });

    // `shapeObject` is synchronous in Pinia (see VolumeParameters for the
    // same pattern), so close can run inline after it.
    const save = () => {
      stageStore.shapeObject({
        ...currentObject.value,
        exitAnimation: parameters.exitAnimation,
        exitSpeed: parameters.exitSpeed,
      });
      emit("close");
    };

    return { save, parameters, previewSrc };
  },
};
</script>

<template>
  <div class="card-header">
    <span class="card-header-title">{{ $t("exit_setting") }}</span>
  </div>
  <div class="card-content">
    <div class="content">
      <ExitSettings
        v-model:animation="parameters.exitAnimation"
        v-model:speed="parameters.exitSpeed"
        :preview-src="previewSrc"
      />
      <SaveButton @click="save" />
    </div>
  </div>
</template>
