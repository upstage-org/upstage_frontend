<script>
import { computed, inject, watch, reactive, ref } from "vue";
import { message } from "ant-design-vue";
import Reorder from "./Reorder.vue";
import ExitSettings from "components/media/ExitSettings.vue";
import SaveButton from "components/form/SaveButton.vue";
import {
  DEFAULT_EXIT_ANIMATION,
  DEFAULT_EXIT_SPEED,
  EXIT_ANIMATED_TYPES,
} from "components/stage/removalAnimations";
import { stageGraph } from "services/graphql";

// Same defensive access as Reorder.vue's assetTypeName: GraphQL returns
// `assetType: { name }`, older payloads may carry a bare string, and
// labels can arrive capitalised.
function assetTypeName(media) {
  const t = media?.assetType;
  const name = t && typeof t === "object" ? (t.name ?? "") : (t ?? "");
  return String(name).toLowerCase();
}

export default {
  components: {
    Reorder,
    ExitSettings,
    SaveButton,
  },
  setup: () => {
    const stage = inject("stage");

    // Local editable copy of each assignment's exit settings, keyed by
    // asset id and rebuilt whenever the stage (or its asset list) changes —
    // exit settings are per (stage, asset) pair, so rows must never
    // survive a stage switch. Edits buffer here until the Save button
    // writes the changed rows; a stage switch discards unsaved edits.
    const exitRows = reactive({});
    let rowsStageId = null;
    const dropRow = (id) => {
      delete exitRows[id];
    };
    const syncRows = () => {
      // Settings are per (stage, asset) pair: a stage switch must not let
      // a media assigned to both stages carry the old stage's row over.
      if (stage.value?.id !== rowsStageId) {
        rowsStageId = stage.value?.id;
        Object.keys(exitRows).forEach(dropRow);
      }
      const assets = stage.value?.assets || [];
      const liveIds = new Set();
      for (const asset of assets) {
        liveIds.add(asset.id);
        if (!exitRows[asset.id]) {
          exitRows[asset.id] = {
            exitAnimation: asset.exitAnimation ?? DEFAULT_EXIT_ANIMATION,
            exitSpeed: asset.exitSpeed ?? DEFAULT_EXIT_SPEED,
          };
        }
      }
      for (const id of Object.keys(exitRows)) {
        if (!liveIds.has(id)) dropRow(id);
      }
    };
    watch(() => [stage.value?.id, stage.value?.assets], syncRows, {
      immediate: true,
      deep: false,
    });

    const animatedAssets = computed(() =>
      (stage.value.assets || []).filter((asset) =>
        EXIT_ANIMATED_TYPES.includes(assetTypeName(asset)),
      ),
    );

    const rowIsDirty = (asset) => {
      const row = exitRows[asset.id];
      if (!row) return false;
      return (
        row.exitAnimation !== (asset.exitAnimation ?? DEFAULT_EXIT_ANIMATION) ||
        row.exitSpeed !== (asset.exitSpeed ?? DEFAULT_EXIT_SPEED)
      );
    };
    const dirtyAssets = computed(() => animatedAssets.value.filter(rowIsDirty));

    const savingExits = ref(false);
    const saveExitSettings = async () => {
      if (savingExits.value) return;
      savingExits.value = true;
      const failed = [];
      let firstError = null;
      for (const asset of dirtyAssets.value) {
        const row = exitRows[asset.id];
        try {
          await stageGraph.updateStageAssignment(
            stage.value.id,
            asset.id,
            row.exitAnimation,
            row.exitSpeed,
          );
          // Keep the injected stage cache in step so revisits don't seed
          // stale values without a refetch. This also marks the row clean.
          asset.exitAnimation = row.exitAnimation;
          asset.exitSpeed = row.exitSpeed;
        } catch (error) {
          failed.push(asset.name);
          firstError ??= error?.response?.errors?.[0]?.message;
        }
      }
      savingExits.value = false;
      if (failed.length) {
        message.error(firstError || `Could not save the exit animation for: ${failed.join(", ")}`);
      } else {
        message.success("Exit animations saved!");
      }
    };

    return {
      selectedMedia: stage.value.assets || [],
      animatedAssets,
      exitRows,
      dirtyAssets,
      savingExits,
      saveExitSettings,
    };
  },
};
</script>

<template>
  <div class="columns">
    <div class="column">
      <b><span>Media assigned to this Stage</span></b>
    </div>
  </div>

  <Reorder v-model="selectedMedia" />

  <template v-if="animatedAssets.length">
    <div class="columns mt-4">
      <div class="column">
        <b><span>Exit animations</span></b>
        <p class="help mb-0">
          How each item leaves this stage when it is removed. The same media can exit differently on
          other stages.
        </p>
      </div>
    </div>
    <div v-for="asset in animatedAssets" :key="asset.id" class="exit-row">
      <div class="media-preview">
        <img v-if="asset.src" :src="asset.src" :alt="asset.name" />
      </div>
      <span class="exit-row-name" :title="asset.name">{{ asset.name }}</span>
      <ExitSettings
        v-if="exitRows[asset.id]"
        compact
        :animation="exitRows[asset.id].exitAnimation"
        :speed="exitRows[asset.id].exitSpeed"
        @update:animation="(value) => (exitRows[asset.id].exitAnimation = value)"
        @update:speed="(value) => (exitRows[asset.id].exitSpeed = value)"
      />
    </div>
    <SaveButton
      class="mt-3"
      data-testid="exit-animations-save"
      :loading="savingExits"
      :disabled="!dirtyAssets.length"
      @click="saveExitSettings"
    />
  </template>
</template>

<style scoped lang="scss">
.media-preview {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0;
  width: 48px;
  height: 48px;
  border-radius: 5px;
  overflow: hidden;

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
}

.type-icon {
  align-self: center;
  padding: 0 16px;
}

.exit-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
}

.exit-row-name {
  min-width: 10em;
  max-width: 16em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
