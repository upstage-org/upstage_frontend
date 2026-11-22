<script setup lang="ts">
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";

// Warning badge shown to EVERYONE on the stage (performers and audience)
// while this browser is out of the Jitsi conference after a connection loss.
// Without it the stage looks completely normal — chat, avatars and tiles keep
// working over MQTT — while no live stream is being sent or received. The
// connection is re-established automatically (useJitsi's rejoin); the badge
// disappears on its own once the conference is joined again.
const stageStore = useStageStore();
const visible = computed(() => stageStore.jitsiConnectionLost);
</script>

<template>
  <a-tooltip v-if="visible" :title="$t('streams_reconnecting_tooltip')">
    <span class="tag is-danger is-small stream-connection-badge" data-testid="streams-reconnecting">
      <span class="icon">
        <i class="fas fa-sync fa-spin"></i>
      </span>
      <span>{{ $t("streams_reconnecting") }}</span>
    </span>
  </a-tooltip>
</template>

<style scoped lang="scss">
.stream-connection-badge {
  gap: 4px;
  white-space: nowrap;
}
</style>
