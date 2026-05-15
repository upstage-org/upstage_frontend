<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { animate } from "animejs";
import Popover from "components/Popover.vue";
import Session from "./Session.vue";
import ReloadStream from "./ReloadStream.vue";

const stageStore = useStageStore();
const dot = ref<HTMLElement>();

// `stageStore.model` is typed as `null` (see Pinia stage store header
// comment); cast for the `status` read. Runtime guard handles the
// pre-loadStage `null` case via the optional chain.
const status = computed<string>(() => {
  const model = stageStore.model as { status?: string } | null;
  if (model?.status == "rehearsal") {
    return "REHEARSAL";
  }
  return stageStore.status;
});
const players = computed(() => stageStore.players);
const audiences = computed(() => stageStore.audiences);
const masquerading = computed<boolean>(() => stageStore.masquerading);
const replaying = inject<boolean>("replaying");

onMounted(() => {
  nextTick(() => {
    if (!dot.value) {
      return;
    }
    animate(dot.value, {
      opacity: [1, 0, 1],
      duration: 2000,
      loop: true,
    });
  });
});
</script>

<template>
  <div id="connection-status">
    <ReloadStream />
    <span
      class="tag is-light is-small"
      :class="{
        'is-danger': status === 'LIVE',
        'is-warning': status === 'CONNECTING',
        'is-rehearsal': status === 'REHEARSAL',
      }"
    >
      <template v-if="replaying">
        <span class="icon">
          <i ref="dot" class="fas fa-circle"></i>
        </span>
        <span class="status-text">{{ $t("replaying") }}</span>
      </template>
      <template v-else>
        <span v-show="masquerading || status !== 'OFFLINE'" class="icon">
          <i ref="dot" class="fas fa-circle"></i>
        </span>
        <span v-show="status === 'OFFLINE'" class="icon">
          <i class="far fa-circle"></i>
        </span>
        <span class="status-text">{{ masquerading ? "REHEARSAL" : status }}</span>
      </template>
    </span>

    <Popover>
      <template #trigger>
        <span class="tag is-dark is-small">
          <span class="icon">
            <i class="fas fa-user"></i>
          </span>
          <span>{{ players.length }}</span>
          <span class="icon">
            <i class="fas fa-desktop"></i>
          </span>
          <span>{{ audiences.length }}</span>
        </span>
      </template>
      <div style="max-height: 50vh; overflow-y: auto">
        <Session v-for="player in players" :key="player.id" :session="player" />
        <Session v-for="audience in audiences" :key="audience.id" :session="audience" />
      </div>
    </Popover>
  </div>
</template>

<style scoped lang="scss">
#connection-status {
  position: fixed;
  right: 12px;
  top: 50px;
  width: 250px;
  text-align: center;
  z-index: 4;

  @media screen and (max-width: 767px) {
    right: unset;
    top: 8px;
    left: 0;
  }
}

.is-rehearsal {
  background-color: #feecf0 !important;
  color: #0000ff !important;
}

.status-text {
  margin-top: 4px;
}
</style>
