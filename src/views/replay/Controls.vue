<template>
  <div v-show="!collapsed" id="replay-controls" class="card is-light">
    <div class="card-body">
      <div class="is-fullwidth my-2 has-text-centered">
        <button
          class="button is-primary is-outlined is-rounded reaction is-small m-1"
          @click="seekBackward"
        >
          <i class="fas fa-fast-backward"></i>
        </button>
        <button
          v-if="isPlaying"
          class="button is-primary is-outlined is-rounded reaction mx-1"
          @click="pause"
        >
          <i class="fas fa-pause"></i>
        </button>
        <button
          v-else
          class="button is-primary is-rounded reaction mx-1"
          @click="play"
        >
          <i class="fas fa-play"></i>
        </button>
        <button
          class="button is-primary is-outlined is-rounded reaction is-small m-1"
          @click="seekForward"
        >
          <i class="fas fa-fast-forward"></i>
        </button>
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
              controls or bring it back.
            </p>
          </template>
        </Modal>
        <teleport v-if="!collapsed" to="body">
          <Modal width="500px" :loading="false">
            <template #render="{ open }">
              <Dropdown
                style="position: absolute; left: 24px; bottom: 64px"
                is-up
                :data="speeds"
                :render-label="renderSpeedLabel"
                v-model="speed"
                @select="(s: number) => changeSpeed(s, open)"
              />
            </template>
            <template #header>{{ $t("warning") }}</template>
            <template #content>
              <p>
                Audio and avatar speeches won't be able to play in 16x speed or more. You
                should only use these playback rate for seeking purpose!
              </p>
            </template>
          </Modal>
        </teleport>
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
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import Dropdown from "components/form/Dropdown.vue";
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
const renderSpeedLabel = (value: number) => `${value}x`;

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

const changeSpeed = (newSpeed: number, open: () => void) => {
  store.commit("stage/SET_REPLAY", { speed: newSpeed });
  if (isPlaying.value) play();
  if (newSpeed >= 16) open();
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
}
</style>
