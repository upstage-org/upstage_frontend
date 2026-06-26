<script>
import { useStageStore } from "@stores/pinia/stage";
import Icon from "components/Icon.vue";
import { computed, ref } from "vue";
import { useShortcut } from "../../composable";
import { displayTimestamp } from "utils/common";
import { animate } from "animejs";

export default {
  components: { Icon },
  setup: () => {
    const stageStore = useStageStore();
    const audios = ref(stageStore.audios || []);
    const audioPlayers = computed(() => stageStore.audioPlayers);

    const togglePlaying = (audio, currentTime) => {
      audio.isPlaying = !audio.isPlaying;
      audio.currentTime = currentTime;
      audio.saken = true;
      stageStore.updateAudioStatus(audio);
    };
    const stopAudio = (audio) => {
      audio.currentTime = 0;
      audio.saken = true;
      audio.isPlaying = false;
      stageStore.updateAudioStatus(audio);
    };
    const toggleLoop = (audio, currentTime) => {
      audio.loop = !audio.loop;
      audio.currentTime = currentTime;
      stageStore.updateAudioStatus(audio);
    };
    const seek = (audio, e) => {
      audio.currentTime = e.target.value;
      audio.saken = true;
      stageStore.updateAudioStatus(audio);
    };
    const setVolume = (audio, _e) => {
      //audio.volume = e.target.value;
      stageStore.updateAudioStatus(audio);
    };

    const masterVolume = computed(() => stageStore.masterAudioVolume);
    // Drag: apply locally (no broadcast) for smooth live feedback; commit and
    // broadcast on release so the audience only gets the settled value.
    const onMasterInput = (e) => stageStore.setMasterAudioVolume(Number(e.target.value), false);
    const onMasterChange = (e) => stageStore.setMasterAudioVolume(Number(e.target.value), true);
    const stopAll = () => stageStore.stopAllAudio();
    const fadeOutAll = () => stageStore.fadeOutAllAudio();

    useShortcut((e) => {
      if (isFinite(e.key)) {
        const i = e.key - 1;
        if (audios.value.length > i && i >= 0) {
          togglePlaying(audios.value[i]);
        }
      }
    });
    const scrollToEnd = () => {
      const topbar = document.querySelector("#topbar");
      if (topbar) {
        animate(topbar, {
          scrollLeft: topbar.scrollWidth,
          ease: "inOutQuad",
        });
      }
    };

    return {
      audios,
      togglePlaying,
      stopAudio,
      toggleLoop,
      setVolume,
      audioPlayers,
      seek,
      displayTimestamp,
      scrollToEnd,
      masterVolume,
      onMasterInput,
      onMasterChange,
      stopAll,
      fadeOutAll,
    };
  },
};
</script>

<template>
  <!-- Master controls: stop / fade-out all, plus a master-volume slider.
       Mirrors the Backdrops "clear" tile sitting at the left-hand end. -->
  <div v-if="audios.length" class="audio-master has-text-centered">
    <div>
      <div class="audio-name">{{ $t("master") || "Master" }}</div>
      <div class="master-buttons">
        <a-tooltip :title="$t('stop_all_audio') || 'Stop all'">
          <div class="icon" @click="stopAll">
            <Icon size="24" src="clear.svg" />
          </div>
        </a-tooltip>
        <a-tooltip :title="$t('fade_out_audio') || 'Fade out'">
          <div class="icon" @click="fadeOutAll">
            <Icon size="24" src="crossfade.svg" />
          </div>
        </a-tooltip>
      </div>
      <a-tooltip :title="$t('master_volume') || 'Master volume'">
        <div class="master-slider">
          <Icon size="16" src="voice-setting.svg" />
          <input
            class="slider is-fullwidth is-dark my-0"
            step="0.01"
            min="0"
            max="1"
            type="range"
            :value="masterVolume"
            @input="onMasterInput($event)"
            @change="onMasterChange($event)"
          />
        </div>
      </a-tooltip>
    </div>
  </div>
  <div
    v-for="(audio, i) in audios"
    :key="audio"
    class="audio has-text-centered"
    :class="{ 'is-playing': audio.isPlaying }"
    @mouseenter="i > audios.length - 3 ? scrollToEnd() : null"
  >
    <div>
      <div class="audio-name">
        <span v-if="i < 10">{{ i + 1 }}.</span>
        <span :title="audio.file">{{ audio.name }}</span>
      </div>
      <div class="buttons">
        <template v-if="audio.isPlaying">
          <div class="icon" @click="togglePlaying(audio, audioPlayers[i]?.currentTime)">
            <Icon size="24" src="pause.svg" />
          </div>
          <div class="icon" @click="stopAudio(audio)">
            <Icon size="24" src="clear.svg" />
          </div>
        </template>
        <template v-else>
          <div class="icon play-button" @click="togglePlaying(audio, audioPlayers[i]?.currentTime)">
            <Icon size="24" src="play.svg" />
          </div>
        </template>
        <div
          class="icon"
          :class="{ grayscale: !audio.loop }"
          @click="toggleLoop(audio, audioPlayers[i]?.currentTime)"
        >
          <Icon size="24" src="loop.svg" />
        </div>
      </div>
      <div class="sliders">
        <div class="addon volume">
          <div class="icon">
            <Icon size="24" src="voice-setting.svg" />
          </div>
          <input
            v-model="audio.volume"
            class="slider is-fullwidth is-dark my-0"
            step="0.01"
            min="0"
            max="1"
            type="range"
            @change="setVolume(audio, $event, audioPlayers[i]?.currentTime)"
          />
        </div>
        <input
          class="slider is-fullwidth is-primary mt-0"
          min="0"
          :max="audioPlayers[i]?.duration"
          :value="audioPlayers[i]?.currentTime ?? 0"
          type="range"
          @change="seek(audio, $event)"
        />
        <div class="addon">
          <span v-if="audio.isPlaying">{{
            displayTimestamp(audioPlayers[i]?.currentTime ?? 0)
          }}</span>
          <span v-else>{{ displayTimestamp(audioPlayers[i]?.duration) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.audio-name {
  font-weight: bold;
  font-size: 0.8rem;
  text-transform: capitalize;
  width: 100%;
  overflow-x: hidden;
  text-overflow: ellipsis;
}

.audio {
  transition-duration: 0.25s;
  overflow-y: hidden;
  margin-top: -6px;
  height: 86px !important;

  > div {
    width: 100%;
  }

  .buttons {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 0;
    height: 32px;

    .play-button {
      height: 36px;

      img {
        height: 48px !important;
      }
    }

    > * {
      margin: 4px 8px;
      display: none;

      &:first-child {
        display: block;
      }
    }
  }

  .sliders {
    display: none !important;
    margin-bottom: 0;
    height: 16px;

    .slider {
      margin: 0 4px;
    }

    .volume {
      .icon {
        width: 12px;
        margin-top: 4px;
      }

      .slider {
        position: absolute;
        top: 8px;
        left: 6px;
        width: 88px;
        transform: scale(0.75) rotate(270deg) translateX(-100%);
        transform-origin: left top;
      }

      // The slider thumb pseudo-element is vendor-prefixed: target each so
      // Firefox (-moz) and IE (-ms) get the same green theming as Chromium.
      .slider::-webkit-slider-thumb {
        background-color: #007011;
        border-color: #f5f5f5;
      }
      .slider::-moz-range-thumb {
        background-color: #007011;
        border-color: #f5f5f5;
      }
      .slider::-ms-thumb {
        background-color: #007011;
        border-color: #f5f5f5;
      }
    }
  }

  &.is-playing {
    .sliders {
      display: flex !important;

      .addon {
        display: none;
      }
    }
  }

  &:hover {
    width: 250px !important;

    .sliders {
      display: flex !important;

      .addon {
        display: block;
      }
    }

    .buttons {
      > * {
        display: block;
      }

      .play-button {
        height: 32px;

        img {
          height: 24px !important;
        }
      }
    }
  }
}

.audio-master {
  > div {
    width: 100%;
  }

  .master-buttons {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 12px;
    margin: 6px 0;

    .icon {
      cursor: pointer;

      &:hover {
        filter: brightness(1.3);
      }
    }
  }

  .master-slider {
    display: flex;
    align-items: center;
    gap: 4px;

    .icon {
      flex: none;
    }

    .slider {
      flex: 1 1 auto;
      min-width: 0;
      margin: 0;
    }
  }
}

.grayscale {
  filter: grayscale(1);
}
</style>
