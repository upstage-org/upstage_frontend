<template>
  <div v-show="!collapsed" id="replay-controls" class="card is-light">
    <div class="card-body">
      <div class="is-fullwidth my-2 has-text-centered controls-row">
        <button
          class="button is-primary is-outlined is-rounded reaction is-small m-1"
          @click="seekBackward"
          title="Skip back 10s"
        >
          <i class="fas fa-fast-backward"></i>
        </button>
        <button
          v-if="isPlaying"
          class="button is-primary is-outlined is-rounded reaction mx-1"
          @click="pause"
          title="Pause"
        >
          <i class="fas fa-pause"></i>
        </button>
        <button
          v-else
          class="button is-primary is-rounded reaction mx-1"
          @click="play"
          title="Play"
        >
          <i class="fas fa-play"></i>
        </button>
        <button
          class="button is-primary is-outlined is-rounded reaction is-small m-1"
          @click="seekForward"
          title="Skip forward 10s"
        >
          <i class="fas fa-fast-forward"></i>
        </button>

        <!-- Inline speed control. Replaces the prior teleported Dropdown
             (which was floated absolutely off the controls card and easy
             to miss). Step buttons walk the discrete `speeds` array; the
             native <select> exposes the same values for one-click jumps.
             Speed changes restart playback at the current timestamp via
             changeSpeed → play, so the new rate takes effect immediately. -->
        <span class="speed-control mx-2" :title="`Replay speed: ${speed}x`">
          <button
            class="button is-light is-small"
            :disabled="speedIndex <= 0"
            @click="stepSpeed(-1)"
            title="Slower"
          >
            <i class="fas fa-minus"></i>
          </button>
          <select class="speed-select mx-1" :value="speed" @change="onSpeedSelect">
            <option v-for="s in speeds" :key="s" :value="s">{{ s }}x</option>
          </select>
          <button
            class="button is-light is-small"
            :disabled="speedIndex >= speeds.length - 1"
            @click="stepSpeed(1)"
            title="Faster"
          >
            <i class="fas fa-plus"></i>
          </button>
        </span>

        <Modal width="500px">
          <template #trigger>
            <button
              class="button minimise is-rounded is-light is-small"
              @click="collapsed = true"
              title="Hide controls (Esc)"
            >
              <span class="icon">
                <Icon src="minimise.svg" size="24" class="mt-4" />
              </span>
            </button>
          </template>
          <template #header>{{ $t("tips") }}</template>
          <template #content>
            <p>
              Replay controls are hidden! You can toggle the
              <code>{{ $t("esc") }}</code> key to quickly hide the replay controls or bring it back.
            </p>
          </template>
        </Modal>
      </div>
    </div>
    <footer class="card-footer">
      <div class="card-footer-item" style="width: 60px">
        {{ displayTimestamp(timestamp.current - timestamp.begin) }}
      </div>
      <div class="card-footer-item">
        <input
          type="range"
          class="slider is-fullwidth my-2"
          style="width: 250px"
          :min="timestamp.begin"
          :max="timestamp.end"
          :value="timestamp.current"
          @change="seek"
        />
        <EventIndicator />
      </div>
      <div class="card-footer-item" style="width: 60px">
        {{ displayTimestamp(timestamp.end - timestamp.begin) }}
      </div>
    </footer>
  </div>

  <!-- Speed warning modal. Opened programmatically when the user picks a
       playback rate at which TTS / audio cannot keep up. Replaces the
       prior pattern of opening the warning Modal as a side-effect of the
       speed Dropdown's render slot. -->
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
              <p>
                Audio and avatar speeches won't be able to play in 16x speed or more. You should
                only use these playback rates for seeking purposes.
              </p>
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

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import Icon from "components/Icon.vue";
import Modal from "components/Modal.vue";
import EventIndicator from "./EventIndicator.vue";
import { useShortcut } from "components/stage/composable";
import { displayTimestamp } from "utils/common";

interface ReplayTimestamp {
  begin: number;
  current: number;
  end: number;
}

const store = useStore();
const timestamp = computed<ReplayTimestamp>(() => store.state.stage.replay.timestamp);
const isPlaying = computed<boolean>(() => store.state.stage.replay.interval);
const speed = computed<number>(() => store.state.stage.replay.speed);
const speeds = [0.5, 1, 2, 4, 8, 16, 32];
const speedIndex = computed<number>(() => {
  // Allow for an unknown stored speed (e.g., set externally) by snapping
  // to the nearest known step rather than returning -1, which would leave
  // both step buttons disabled and trap the UI.
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

const seek = (e: Event) => {
  const target = e.target as HTMLInputElement;
  store.dispatch("stage/replayRecording", target.value);
};

const play = () => {
  store.dispatch("stage/replayRecording", timestamp.value.current);
};

const pause = () => {
  store.dispatch("stage/pauseReplay");
};

const applySpeed = (newSpeed: number) => {
  store.commit("stage/SET_REPLAY", { speed: newSpeed });
  // If we're mid-playback, restart at the current timestamp so the new
  // rate takes effect immediately (replayRecording reads `speed` at the
  // top of the action and reschedules every event timer).
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

const seekForward = () => store.dispatch("stage/seekForwardReplay");
const seekBackward = () => store.dispatch("stage/seekBackwardReplay");

const collapsed = ref<boolean>(false);

useShortcut((e: KeyboardEvent) => {
  if (e.keyCode == 27) {
    collapsed.value = !collapsed.value;
  }
});
</script>

<style lang="scss">
#replay-controls {
  position: fixed;
  left: 16px;
  bottom: 16px;
  height: 108px;
  .button.is-rounded {
    width: 16px;
  }
  .card-footer-item {
    padding-top: 0;
    padding-bottom: 0;
    flex-wrap: wrap;
  }
  input[type="range"] {
    &::-webkit-slider-thumb {
      position: relative;
      z-index: 100;
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
