<template>
  <div v-show="!collapsed" id="replay-controls" class="card is-light">
    <div class="card-body">
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
      <div class="is-flex is-flex-wrap-wrap is-align-items-center is-gap-1 my-1">
        <label class="checkbox is-small">
          <input type="checkbox" v-model="loop" @change="onLoopChange" />
          <span class="ml-1">{{ $t("replay_loop") }}</span>
        </label>
        <template v-if="loop">
          <span class="is-size-7">{{ $t("replay_iterations") }}</span>
          <input
            type="number"
            class="input is-small"
            style="width: 4rem"
            min="1"
            :placeholder="$t('replay_loop_infinite')"
            v-model.number="loopMaxInput"
          />
          <span v-if="loopMax != null && loopMax > 0" class="is-size-7">
            ({{ replayLoopCount }}/{{ loopMax }})
          </span>
        </template>
      </div>
      <details v-if="hasEvents" class="mt-1">
        <summary class="is-size-7">{{ $t("replay_trim") }}</summary>
        <div class="is-flex is-flex-wrap-wrap is-align-items-center is-gap-1 mt-1">
          <span class="is-size-7">{{ $t("replay_trim_start") }}</span>
          <input
            type="number"
            class="input is-small"
            style="width: 5rem"
            :min="fullRange.begin"
            :max="fullRange.end"
            v-model.number="trimStart"
          />
          <span class="is-size-7">{{ $t("replay_trim_end") }}</span>
          <input
            type="number"
            class="input is-small"
            style="width: 5rem"
            :min="fullRange.begin"
            :max="fullRange.end"
            v-model.number="trimEnd"
          />
          <button
            class="button is-small is-light"
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
    const timestamp = computed(() => store.state.stage.replay.timestamp);
    const isPlaying = computed(() => store.state.stage.replay.interval);
    const speed = computed(() => store.state.stage.replay.speed);
    const speeds = [0.5, 1, 2, 4, 8, 16, 32];
    const loop = computed({
      get: () => store.state.stage.replay.loop,
      set: (v) => store.commit("stage/SET_REPLAY", { loop: v }),
    });
    const loopMax = computed(() => store.state.stage.replay.loopMax);
    const replayLoopCount = computed(() => store.state.stage.replay.loopCount);
    const loopMaxInput = ref(loopMax.value ?? "");
    watch(loopMax, (v) => { loopMaxInput.value = v ?? ""; });
    watch(loopMaxInput, (v) => {
      const n = v === "" || v == null ? null : Number(v);
      store.commit("stage/SET_REPLAY", {
        loopMax: n != null && n >= 1 ? n : null,
      });
    });

    const events = computed(() => store.state.stage.model?.events ?? []);
    const hasEvents = computed(() => events.value.length > 0);
    const fullRange = computed(() => {
      const ev = events.value;
      const ts = timestamp.value;
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
      loopMaxInput,
      replayLoopCount,
      onLoopChange,
      hasEvents,
      fullRange,
      trimStart,
      trimEnd,
      applyTrim,
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
</style>
