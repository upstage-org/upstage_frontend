<script setup lang="ts">
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { isJitsiBoardType } from "@utils/common";

const stageStore = useStageStore();
const objects = computed(() => stageStore.objects);
const hasMeeting = computed(() => objects.value.some((el) => el.type === "meeting"));
const hasJitsi = computed(() => objects.value.some((el) => isJitsiBoardType(el.type)));
const hasMeetingOrJitsi = computed(() => hasMeeting.value || hasJitsi.value);

const onReloadStreams = () => stageStore.triggerReloadStreams();
const onRefreshMeeting = () => stageStore.refreshMeeting();
</script>

<template>
  <div v-if="hasMeetingOrJitsi" id="reload-stream">
    <a-tooltip v-if="hasMeeting" :title="$t('refresh_meeting_tooltip')">
      <button
        class="button is-small refresh-icon clickable"
        type="button"
        :aria-label="$t('refresh_meeting')"
        @mousedown="onRefreshMeeting"
      >
        <i class="fas fa-video" />
      </button>
    </a-tooltip>
    <a-tooltip v-if="hasJitsi" :title="$t('refresh_streams_tooltip')">
      <button
        class="button is-small refresh-icon clickable"
        type="button"
        :aria-label="$t('refresh_streams')"
        @mousedown="onReloadStreams"
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
