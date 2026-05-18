<script setup lang="ts">
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { isJitsiBoardType } from "@utils/common";

const stageStore = useStageStore();
const objects = computed<{ type?: string }[]>(() => stageStore.objects);
const hasJitsi = computed(() => objects.value.some((el) => isJitsiBoardType(el.type)));
const onReload = () => stageStore.triggerReloadStreams();
</script>

<template>
  <div v-if="hasJitsi" id="reload-stream">
    <a-tooltip title="Refresh streams">
      <button class="button is-small refresh-icon clickable" @mousedown="onReload">
        <i class="fas fa-sync"></i>
      </button>
    </a-tooltip>
  </div>
</template>

<style scoped lang="scss">
#reload-stream {
  display: inline-block;
  margin-right: 10px;

  @media screen and (max-width: 767px) {
    right: unset;
    top: 8px;
    left: 0;
  }
}

.refresh-icon {
  width: 24px;
  height: 24px;
  padding: 0px;
  border-radius: 4px;

  &:hover {
    transform: scale(1.2);
  }
}
</style>
