<script>
import { computed, inject, watch, reactive } from "vue";
import { message } from "ant-design-vue";
import Reorder from "./Reorder.vue";
import ExitSettings from "components/media/ExitSettings.vue";
import { DEFAULT_EXIT_ANIMATION, DEFAULT_EXIT_SPEED } from "components/stage/removalAnimations";
import { stageGraph } from "services/graphql";

// Only these types render on the board and run a removal animation.
// (Streams fold to "video" on the board — see SET_MODEL — so they exit too.)
const ANIMATED_TYPES = ["avatar", "prop", "video", "stream"];

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
  },
  setup: () => {
    const stage = inject("stage");

    // Local editable copy of each assignment's exit settings, keyed by
    // asset id and rebuilt whenever the stage (or its asset list) changes —
    // exit settings are per (stage, asset) pair, so rows must never
    // survive a stage switch. Saves are per-row and immediate (this panel
    // has no global Save button).
    const exitRows = reactive({});
    let rowsStageId = null;
    const dropRow = (id) => {
      if (exitRows[id]?.timer) window.clearTimeout(exitRows[id].timer);
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
            saving: false,
            timer: null,
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
      (stage.value.assets || []).filter((asset) => ANIMATED_TYPES.includes(assetTypeName(asset))),
    );

    const saveExitSettings = (asset) => {
      const row = exitRows[asset.id];
      if (!row) return;
      // Debounce: the speed slider emits continuously while dragging.
      if (row.timer) window.clearTimeout(row.timer);
      row.timer = window.setTimeout(async () => {
        row.timer = null;
        row.saving = true;
        try {
          await stageGraph.updateStageAssignment(
            stage.value.id,
            asset.id,
            row.exitAnimation,
            row.exitSpeed,
          );
          // Keep the injected stage cache in step so revisits don't seed
          // stale values without a refetch.
          asset.exitAnimation = row.exitAnimation;
          asset.exitSpeed = row.exitSpeed;
        } catch (error) {
          message.error(
            error?.response?.errors?.[0]?.message || "Could not save the exit animation.",
          );
        } finally {
          row.saving = false;
        }
      }, 400);
    };

    return {
      selectedMedia: stage.value.assets || [],
      animatedAssets,
      exitRows,
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
          other stages; changes here save immediately.
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
        @update:animation="
          (value) => {
            exitRows[asset.id].exitAnimation = value;
            saveExitSettings(asset);
          }
        "
        @update:speed="
          (value) => {
            exitRows[asset.id].exitSpeed = value;
            saveExitSettings(asset);
          }
        "
      />
      <a-spin v-if="exitRows[asset.id]?.saving" size="small" />
    </div>
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
