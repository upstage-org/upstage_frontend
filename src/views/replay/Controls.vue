<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import { useI18n } from "vue-i18n";
import { message } from "ant-design-vue";
import Icon from "components/Icon.vue";
import Modal from "components/Modal.vue";
import EventIndicator from "./EventIndicator.vue";
import { useShortcut } from "components/stage/composable";
import { displayTimestamp } from "utils/common";
import { saveReplayMarkers } from "@utils/replayMarkers";

interface ReplayTimestamp {
  begin: number;
  current: number;
  end: number;
}

const { t } = useI18n();
const stageStore = useStageStore();
const timestamp = computed<ReplayTimestamp>(() => stageStore.replay.timestamp);
const isPlaying = computed<boolean>(() => !!stageStore.replay.interval);
const speed = computed<number>(() => stageStore.replay.speed);
const loopEnabled = computed<boolean>(() => !!stageStore.replay.loop);
const speeds = [0.5, 1, 2, 4, 8, 16, 32];
const speedIndex = computed<number>(() => {
  const i = speeds.indexOf(speed.value);
  if (i >= 0) return i;
  let best = 0;
  let bestDist = Math.abs(speeds[0] - speed.value);
  for (let k = 1; k < speeds.length; k += 1) {
    const d = Math.abs(speeds[k] - speed.value);
    if (d < bestDist) {
      best = k;
      bestDist = d;
    }
  }
  return best;
});

const showSpeedWarning = ref<boolean>(false);
const scrubValue = ref<number>(0);
const seekDebounce = ref<ReturnType<typeof setTimeout> | null>(null);
const markerLabel = ref("");

const syncScrub = () => {
  scrubValue.value = timestamp.value.current;
};
syncScrub();

watch(
  () => timestamp.value.current,
  () => {
    syncScrub();
  },
);

const scheduleSeek = (value: number) => {
  scrubValue.value = value;
  if (seekDebounce.value) clearTimeout(seekDebounce.value);
  seekDebounce.value = setTimeout(() => {
    stageStore.replayRecording(value);
  }, 120);
};

const onScrubInput = (e: Event) => {
  const target = e.target as HTMLInputElement;
  scheduleSeek(Number(target.value));
};

const onScrubChange = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (seekDebounce.value) {
    clearTimeout(seekDebounce.value);
    seekDebounce.value = null;
  }
  stageStore.replayRecording(target.value);
};

const onIndicatorSeek = (mqttTimestamp: number) => {
  if (seekDebounce.value) {
    clearTimeout(seekDebounce.value);
    seekDebounce.value = null;
  }
  stageStore.replayRecording(mqttTimestamp);
};

const play = () => {
  stageStore.replayRecording(timestamp.value.current);
};

const pause = () => {
  stageStore.pauseReplay();
};

const toggleLoop = () => {
  stageStore.SET_REPLAY({ loop: !loopEnabled.value });
};

const applySpeed = (newSpeed: number) => {
  stageStore.SET_REPLAY({ speed: newSpeed });
  if (isPlaying.value) play();
  if (newSpeed >= 16) showSpeedWarning.value = true;
};

const stepSpeed = (delta: number) => {
  const next = Math.min(speeds.length - 1, Math.max(0, speedIndex.value + delta));
  if (speeds[next] !== speed.value) applySpeed(speeds[next]);
};

const onSpeedSelect = (e: Event) => {
  const target = e.target as HTMLSelectElement;
  const v = Number(target.value);
  if (Number.isFinite(v) && speeds.includes(v) && v !== speed.value) {
    applySpeed(v);
  }
};

const addMarker = () => {
  const label = markerLabel.value.trim();
  if (!label) {
    message.warning(t("replay_marker_label_required"));
    return;
  }
  const performanceId = stageStore.replay.performanceId;
  if (!performanceId) return;
  const id = `mk-${Date.now()}`;
  const next = [
    ...(stageStore.replay.markers ?? []),
    { id, label, mqttTimestamp: timestamp.value.current },
  ].sort((a, b) => a.mqttTimestamp - b.mqttTimestamp);
  stageStore.SET_REPLAY({ markers: next });
  saveReplayMarkers(performanceId, next);
  markerLabel.value = "";
  message.success(t("replay_marker_added"));
};

const seekForward = () => stageStore.seekForwardReplay();
const seekBackward = () => stageStore.seekBackwardReplay();

const collapsed = ref<boolean>(false);

useShortcut((e: KeyboardEvent) => {
  if (e.key === "Escape") {
    collapsed.value = !collapsed.value;
  }
});
</script>

<template>
  <div v-show="!collapsed" id="replay-controls" class="card is-light">
    <div class="card-body">
      <div class="is-fullwidth my-2 has-text-centered controls-row">
        <button
          class="button is-primary is-outlined is-rounded reaction is-small m-1"
          :title="$t('replay_skip_back')"
          @click="seekBackward"
        >
          <i class="fas fa-fast-backward"></i>
        </button>
        <button
          v-if="isPlaying"
          class="button is-primary is-outlined is-rounded reaction mx-1"
          :title="$t('pause')"
          @click="pause"
        >
          <i class="fas fa-pause"></i>
        </button>
        <button v-else class="button is-primary is-rounded reaction mx-1" :title="$t('play')" @click="play">
          <i class="fas fa-play"></i>
        </button>
        <button
          class="button is-primary is-outlined is-rounded reaction is-small m-1"
          :title="$t('replay_skip_forward')"
          @click="seekForward"
        >
          <i class="fas fa-fast-forward"></i>
        </button>

        <button
          class="button is-light is-small"
          :class="{ 'is-info': loopEnabled }"
          :title="$t('replay_loop')"
          @click="toggleLoop"
        >
          <i class="fas fa-redo"></i>
        </button>

        <span class="speed-control mx-2" :title="`Replay speed: ${speed}x`">
          <button
            class="button is-light is-small"
            :disabled="speedIndex <= 0"
            :title="$t('slower')"
            @click="stepSpeed(-1)"
          >
            <i class="fas fa-minus"></i>
          </button>
          <select class="speed-select mx-1" :value="speed" @change="onSpeedSelect">
            <option v-for="s in speeds" :key="s" :value="s">{{ s }}x</option>
          </select>
          <button
            class="button is-light is-small"
            :disabled="speedIndex >= speeds.length - 1"
            :title="$t('faster')"
            @click="stepSpeed(1)"
          >
            <i class="fas fa-plus"></i>
          </button>
        </span>

        <Modal width="500px">
          <template #trigger>
            <button
              class="button minimise is-rounded is-light is-small"
              :title="$t('replay_hide_controls')"
              @click="collapsed = true"
            >
              <span class="icon">
                <Icon src="minimise.svg" size="24" class="mt-4" />
              </span>
            </button>
          </template>
          <template #header>{{ $t("tips") }}</template>
          <template #content>
            <p>
              {{ $t("replay_controls_hidden_hint", { key: $t("esc") }) }}
            </p>
          </template>
        </Modal>
      </div>
    </div>
    <footer class="card-footer scrub-footer">
      <div class="card-footer-item time-label">
        {{ displayTimestamp(timestamp.current - timestamp.begin) }}
      </div>
      <div class="card-footer-item scrub-column">
        <EventIndicator seekable @seek="onIndicatorSeek" />
        <input
          type="range"
          class="slider scrub-slider"
          :min="timestamp.begin"
          :max="timestamp.end"
          :value="scrubValue"
          @input="onScrubInput"
          @change="onScrubChange"
        />
        <div class="marker-row">
          <input
            v-model="markerLabel"
            class="input is-small marker-input"
            type="text"
            :placeholder="$t('replay_marker_placeholder')"
            @keyup.enter="addMarker"
          />
          <button type="button" class="button is-small is-light" @click="addMarker">
            {{ $t("replay_add_marker") }}
          </button>
        </div>
      </div>
      <div class="card-footer-item time-label">
        {{ displayTimestamp(timestamp.end - timestamp.begin) }}
      </div>
    </footer>
  </div>

  <teleport to="body">
    <div v-if="showSpeedWarning" class="modal is-active">
      <div class="modal-background" @click="showSpeedWarning = false"></div>
      <div class="modal-content">
        <div class="card">
          <header class="card-header">
            <p class="card-header-title">{{ $t("warning") }}</p>
          </header>
          <div class="card-content">
            <div class="content">
              <p>{{ $t("replay_speed_warning") }}</p>
            </div>
          </div>
          <footer class="card-footer">
            <a class="card-footer-item" @click="showSpeedWarning = false"> OK </a>
          </footer>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style lang="scss">
#replay-controls {
  position: fixed;
  left: 16px;
  bottom: 16px;
  min-height: 108px;
  max-width: min(92vw, 520px);

  .button.is-rounded {
    width: 16px;
  }

  .scrub-footer {
    flex-wrap: nowrap;
    align-items: flex-start;
    gap: 8px;
  }

  .time-label {
    width: 56px;
    flex-shrink: 0;
    padding-top: 18px;
    font-size: 0.75rem;
  }

  .scrub-column {
    flex: 1 1 auto;
    min-width: 0;
    flex-direction: column;
    align-items: stretch;
    padding-top: 4px;
    padding-bottom: 8px;
  }

  .scrub-slider {
    width: 100%;
    margin: 4px 0 0;
  }

  .marker-row {
    display: flex;
    gap: 6px;
    margin-top: 6px;

    .marker-input {
      flex: 1;
      min-width: 0;
    }
  }

  .button.minimise {
    position: absolute;
    right: 8px;
  }

  .controls-row {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    flex-wrap: nowrap;
    position: relative;
    width: 100%;
  }

  .speed-control {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px;
    border-left: 1px solid rgba(0, 0, 0, 0.1);
    border-right: 1px solid rgba(0, 0, 0, 0.1);

    .speed-select {
      appearance: none;
      -webkit-appearance: none;
      background-color: #fff;
      border: 1px solid rgba(0, 0, 0, 0.15);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 0.85rem;
      font-weight: 600;
      min-width: 56px;
      text-align: center;
      cursor: pointer;
    }

    .button.is-small {
      width: 28px;
    }
  }
}
</style>
