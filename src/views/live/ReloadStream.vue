<script setup lang="ts">
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { isJitsiBoardType } from "@utils/common";

const stageStore = useStageStore();
const objects = computed(() => stageStore.objects);
const hasMeeting = computed(() => objects.value.some((el) => el.type === "meeting"));
const hasJitsi = computed(() => objects.value.some((el) => isJitsiBoardType(el.type)));
// Live RTMP feed tiles (only placed RTMP tiles carry `isRTMP`); their
// player reconnects on the same force-reload signal as jitsi tiles.
const hasRtmp = computed(() => objects.value.some((el) => el.isRTMP === true));
const hasRefreshableStreams = computed(() => hasMeeting.value || hasJitsi.value || hasRtmp.value);

// Explicit user click ⇒ force path: re-publishes / re-attaches even when the
// tracks look "healthy", so a frozen (but not disconnected) stream actually
// recovers instead of no-opping. The automatic page-wake reload stays gentle.
// One button refreshes everything on stage; each signal only fires for the
// object kinds actually present so the merged handler stays a no-op-free
// union of the two old per-kind buttons. Both signals are LOCAL store ticks
// (nothing is sent over MQTT) — only this browser's tiles react. Meeting
// tiles only reload when their embed failed to load; a joined meeting is
// never torn down (that would mute the performer's webcam/mic on rejoin).
const onRefreshStreams = () => {
  if (hasJitsi.value || hasRtmp.value) {
    stageStore.triggerForceReloadStreams();
  }
  if (hasMeeting.value) {
    stageStore.refreshMeeting();
  }
};
</script>

<template>
  <div v-if="hasRefreshableStreams" id="reload-stream">
    <a-tooltip :title="$t('refresh_streams')">
      <button
        class="button is-small refresh-icon clickable"
        type="button"
        :aria-label="$t('refresh_streams')"
        @mousedown="onRefreshStreams"
      >
        <i class="fas fa-sync" />
      </button>
    </a-tooltip>
  </div>
</template>

<style scoped lang="scss">
#reload-stream {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.refresh-icon {
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 4px;

  &:hover {
    transform: scale(1.2);
  }
}
</style>
