<script>
import { reactive, computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import HorizontalField from "components/form/HorizontalField.vue";
import SaveButton from "components/form/SaveButton.vue";

// Per-stream transparency control, mirroring VolumeParameters. Opacity is
// stored on the board object as a 0..1 fraction (Moveable binds it straight
// to CSS `opacity`), so the 0..100 slider here is divided by 100 on save and
// multiplied by 100 to seed the initial value. Reusing the popup pattern
// keeps this hold-independent: the inline OpacitySlider only renders while a
// holdable tile is actively held, which left audience-facing stream tiles
// with no reachable transparency control from the right-click menu.
export default {
  components: {
    HorizontalField,
    SaveButton,
  },
  emits: ["close"],
  setup: (props, { emit }) => {
    const stageStore = useStageStore();
    const currentObject = computed(() => stageStore.activeObject);
    const parameters = reactive({
      opacity: Math.round((currentObject.value?.opacity ?? 1) * 100),
    });

    // `shapeObject` is synchronous in Pinia (same as VolumeParameters).
    const saveOpacity = () => {
      stageStore.shapeObject({
        ...currentObject.value,
        opacity: parameters.opacity / 100,
      });
      emit("close");
    };

    return {
      saveOpacity,
      parameters,
    };
  },
};
</script>

<template>
  <div class="card-header">
    <span class="card-header-title">{{ $t("transparency_setting") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <div class="content">
      <HorizontalField :title="$t('opacity')">
        <a-slider v-model:value="parameters.opacity" :min="0" :max="100" />
      </HorizontalField>
      <SaveButton @click="saveOpacity" />
    </div>
  </div>
</template>

<style lang="scss"></style>
