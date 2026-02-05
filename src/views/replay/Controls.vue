<template>
  <div v-show="!collapsed" id="replay-controls" class="card is-light">
    <div class="card-body">
      <div class="replay-section-title replay-playback-title">{{ $t("replay_playback") }}</div>
      <div class="is-fullwidth my-2 has-text-centered">
        <a-tooltip title="Rewind 10s">
          <button
            class="button is-primary is-outlined is-rounded reaction is-small m-1"
            @click="seekBackward"
            aria-label="Rewind 10 seconds"
          >
            <i class="fas fa-fast-backward"></i>
          </button>
        </a-tooltip>
        <a-tooltip :title="$t('replay_jump_prev_event')">
          <button
            class="button is-primary is-outlined is-rounded reaction is-small m-1"
            @click="seekToPreviousEvent"
            :disabled="!hasPreviousEvent"
            aria-label="Previous event"
          >
            <i class="fas fa-step-backward"></i>
          </button>
        </a-tooltip>
        <button
          v-if="isPlaying"
          class="button is-primary is-outlined is-rounded reaction mx-1"
          @click="pause"
          aria-label="Pause"
        >
          <i class="fas fa-pause"></i>
        </button>
        <button
          v-else
          class="button is-primary is-rounded reaction mx-1"
          @click="play"
          aria-label="Play"
        >
          <i class="fas fa-play"></i>
        </button>
        <a-tooltip :title="$t('replay_jump_next_event')">
          <button
            class="button is-primary is-outlined is-rounded reaction is-small m-1"
            @click="seekToNextEvent"
            :disabled="!hasNextEvent"
            aria-label="Next event"
          >
            <i class="fas fa-step-forward"></i>
          </button>
        </a-tooltip>
        <a-tooltip title="Forward 10s">
          <button
            class="button is-primary is-outlined is-rounded reaction is-small m-1"
            @click="seekForward"
            aria-label="Forward 10 seconds"
          >
            <i class="fas fa-fast-forward"></i>
          </button>
        </a-tooltip>
        <Modal width="500px">
          <template #trigger>
            <button
              class="button minimise is-rounded is-light is-small"
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
              Replay controls are hidden! You can toggle the
              <code>{{ $t("esc") }}</code> key to quickly hide the replay
              controls or bring it back 👌
            </p>
          </template>
        </Modal>
        <teleport v-if="!collapsed" to="body">
          <Modal
            width="500px"
            @confirm="(close) => saveRole(item, close)"
            :loading="loading"
          >
            <template #render="{ open }">
              <Dropdown
                style="position: absolute; left: 24px; bottom: 64px"
                is-up
                :data="speeds"
                :render-label="(value) => value + 'x'"
                v-model="speed"
                @select="changeSpeed($event, open)"
              />
            </template>
            <template #header>{{ $t("warning") }}</template>
            <template #content>
              <p>
                Audio and avatar speeches won't be able to play in 16x speed or
                more. You should only use these playback rate for seeking
                purpose!
              </p>
            </template>
          </Modal>
        </teleport>
      </div>
      <div class="replay-section replay-loop-section">
        <div class="replay-section-title">{{ $t("replay_loop") }}</div>
        <div class="is-flex is-flex-wrap-wrap is-align-items-center is-gap-2">
          <label class="checkbox replay-checkbox">
            <input type="checkbox" v-model="loop" @change="onLoopChange" />
            <span>{{ $t("replay_loop_enable") }}</span>
          </label>
          <template v-if="loop">
            <span class="replay-label">{{ $t("replay_iterations") }}:</span>
            <select
              class="select is-small replay-select"
              v-model="loopOption"
            >
              <option value="infinite">{{ $t("replay_loop_infinite") }}</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
              <option value="10">10</option>
            </select>
            <span v-if="loopMax != null && loopMax > 0" class="replay-loop-count">
              {{ $t("replay_loop_count", { current: replayLoopCount, max: loopMax }) }}
            </span>
          </template>
        </div>
      </div>
      <div v-if="hasEvents" class="replay-section replay-compress-section">
        <div class="replay-section-title">{{ $t("replay_auto_compress") }}</div>
        <p class="replay-compress-desc is-size-7 mb-2">{{ $t("replay_auto_compress_desc") }}</p>
        <div class="is-flex is-flex-wrap-wrap is-align-items-center is-gap-2">
          <label class="replay-label">{{ $t("replay_auto_compress_minutes") }}</label>
          <input
            type="number"
            class="input is-small replay-compress-input"
            min="1"
            max="999"
            v-model.number="deadSpaceMinutes"
          />
          <button
            class="button is-small is-info"
            :disabled="!deadSpaceMinutes || deadSpaceMinutes < 1"
            @click="applyCompress"
          >
            {{ $t("replay_auto_compress_apply") }}
          </button>
          <button
            v-if="useCompressed"
            class="button is-small is-light"
            @click="clearCompress"
          >
            {{ $t("replay_auto_compress_clear") }}
          </button>
        </div>
      </div>
      <details v-if="hasEvents" class="replay-section replay-trim-section">
        <summary class="replay-section-title">{{ $t("replay_trim") }}</summary>
        <div class="replay-trim-fields is-flex is-flex-wrap-wrap is-align-items-center is-gap-2">
          <label class="replay-label">{{ $t("replay_trim_start") }}</label>
          <input
            type="number"
            class="input is-small replay-trim-input"
            :min="fullRange.begin"
            :max="fullRange.end"
            v-model.number="trimStart"
          />
          <label class="replay-label">{{ $t("replay_trim_end") }}</label>
          <input
            type="number"
            class="input is-small replay-trim-input"
            :min="fullRange.begin"
            :max="fullRange.end"
            v-model.number="trimEnd"
          />
          <button
            class="button is-small is-primary"
            @click="applyTrim"
          >
            {{ $t("replay_trim_apply") }}
          </button>
        </div>
      </details>
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
</template>

<script>
import Dropdown from "components/form/Dropdown.vue";
import Icon from "components/Icon.vue";
import Modal from "components/Modal.vue";
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import EventIndicator from "./EventIndicator.vue";
import { useShortcut } from "components/stage/composable";
import { displayTimestamp } from "utils/common";

export default {
  components: { Dropdown, EventIndicator, Icon, Modal },
  setup() {
    const store = useStore();
    const timestamp = computed(() => store.getters["stage/replayEffectiveTimestamp"]);
    const useCompressed = computed(() => store.getters["stage/replayUseCompressed"]);
    const isPlaying = computed(() => store.state.stage.replay.interval);
    const speed = computed(() => store.state.stage.replay.speed);
    const speeds = [0.5, 1, 2, 4, 8, 16, 32];
    const loop = computed({
      get: () => store.state.stage.replay.loop,
      set: (v) => store.commit("stage/SET_REPLAY", { loop: v }),
    });
    const loopMax = computed(() => store.state.stage.replay.loopMax);
    const replayLoopCount = computed(() => store.state.stage.replay.loopCount);
    const loopOptions = ["infinite", "2", "3", "4", "5", "10"];
    const loopOption = computed({
      get: () =>
        loopMax.value == null
          ? "infinite"
          : loopOptions.includes(String(loopMax.value))
            ? String(loopMax.value)
            : "infinite",
      set: (v) => {
        const n = v === "infinite" ? null : Number(v);
        store.commit("stage/SET_REPLAY", {
          loopMax: n != null && n >= 1 ? n : null,
        });
      },
    });

    const events = computed(() => store.getters["stage/replayEffectiveEvents"] ?? []);
    const originalEvents = computed(() => store.state.stage.model?.events ?? []);
    const originalTimestamp = computed(() => store.state.stage.replay.timestamp);
    const hasEvents = computed(() => originalEvents.value.length > 0);
    const fullRange = computed(() => {
      const ev = originalEvents.value;
      const ts = originalTimestamp.value;
      return {
        begin: ev[0]?.mqttTimestamp ?? ts.begin,
        end: ev[ev.length - 1]?.mqttTimestamp ?? ts.end,
      };
    });
    const hasPreviousEvent = computed(() => {
      const current = timestamp.value.current;
      return events.value.some((e) => e.mqttTimestamp < current);
    });
    const hasNextEvent = computed(() => {
      const current = timestamp.value.current;
      return events.value.some((e) => e.mqttTimestamp > current);
    });

    const trimStart = ref(null);
    const trimEnd = ref(null);
    const deadSpaceMinutes = ref(5);

    const applyCompress = () => {
      const n = deadSpaceMinutes.value;
      if (n != null && n >= 1) {
        store.dispatch("stage/computeCompressedReplay", n);
      }
    };

    const clearCompress = () => {
      store.dispatch("stage/clearCompressedReplay");
    };

    const onLoopChange = () => {
      store.commit("stage/SET_REPLAY", { loop: loop.value });
    };

    const seek = (e) => {
      store.dispatch("stage/replayRecording", e.target.value);
    };

    const play = () => {
      store.dispatch("stage/replayRecording", timestamp.value.current);
    };

    const pause = () => {
      store.dispatch("stage/pauseReplay");
    };

    const changeSpeed = (speedVal, open) => {
      store.commit("stage/SET_REPLAY", { speed: speedVal });
      if (isPlaying.value) {
        play();
      }
      if (speedVal >= 16) {
        open();
      }
    };

    const seekForward = () => {
      store.dispatch("stage/seekForwardReplay");
    };

    const seekBackward = () => {
      store.dispatch("stage/seekBackwardReplay");
    };

    const seekToNextEvent = () => {
      store.dispatch("stage/seekToNextEventReplay");
    };

    const seekToPreviousEvent = () => {
      store.dispatch("stage/seekToPreviousEventReplay");
    };

    const applyTrim = () => {
      const start = trimStart.value;
      const end = trimEnd.value;
      if (start != null && end != null && start < end) {
        store.dispatch("stage/setReplayTrim", { begin: start, end });
      }
    };

    const collapsed = ref(false);

    useShortcut((e) => {
      if (e.keyCode == 27) {
        collapsed.value = !collapsed.value;
      }
    });

    return {
      timestamp,
      seek,
      isPlaying,
      play,
      pause,
      displayTimestamp,
      speed,
      speeds,
      changeSpeed,
      seekForward,
      seekBackward,
      seekToNextEvent,
      seekToPreviousEvent,
      hasPreviousEvent,
      hasNextEvent,
      collapsed,
      loop,
      loopMax,
      loopOption,
      replayLoopCount,
      onLoopChange,
      hasEvents,
      fullRange,
      trimStart,
      trimEnd,
      applyTrim,
      useCompressed,
      deadSpaceMinutes,
      applyCompress,
      clearCompress,
    };
  },
};
</script>

<style lang="scss">
#replay-controls {
  position: fixed;
  left: 16px;
  bottom: 16px;
  min-height: 108px;
  max-width: 420px;
  font-size: 14px;
  .card-body {
    padding: 12px 14px;
  }
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
}

.replay-playback-title {
  margin-bottom: 4px;
}

.replay-section {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}

.replay-section-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 6px;
  color: #363636;
  display: block;
}

.replay-label {
  font-size: 13px;
  color: #4a4a4a;
}

.replay-checkbox {
  font-size: 13px;
  margin-bottom: 0;
  span {
    margin-left: 6px;
  }
}

.replay-select {
  min-width: 100px;
  font-size: 13px;
}

.replay-loop-count {
  font-size: 13px;
  color: #4a4a4a;
}

.replay-trim-section summary {
  cursor: pointer;
  list-style: none;
  &::-webkit-details-marker {
    display: none;
  }
  &::before {
    content: "▸ ";
    font-size: 12px;
  }
}
.replay-trim-section[open] summary::before {
  content: "▾ ";
}

.replay-trim-fields {
  margin-top: 8px;
}

.replay-trim-input {
  width: 90px;
}
</style>
