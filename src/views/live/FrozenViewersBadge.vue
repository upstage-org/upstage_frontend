<script setup lang="ts">
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";

// Top-right warning badge shown to a performer when one or more viewers report
// that their view of this performer's stream has frozen (no new frames). The
// count self-corrects as viewers recover / leave. Only performers see it, and
// only while the count is above zero. Sits alongside the existing connection
// status indicators (see ConnectionStatus.vue). Clicking "Refresh streams"
// should drive the count back down; if it doesn't, the stream is genuinely
// broken.
const stageStore = useStageStore();
const count = computed(() => stageStore.frozenViewerCount);
const canPlay = computed(() => stageStore.canPlay);
const visible = computed(() => canPlay.value && count.value > 0);
</script>

<template>
  <a-tooltip v-if="visible" :title="$t('frozen_viewers_tooltip')">
    <span class="tag is-warning is-small frozen-viewers-badge">
      <span class="icon">
        <i class="fas fa-snowflake"></i>
      </span>
      <span>{{ $t("frozen_viewers", { count }) }}</span>
    </span>
  </a-tooltip>
</template>

<style scoped lang="scss">
.frozen-viewers-badge {
  gap: 4px;
  white-space: nowrap;
}
</style>
