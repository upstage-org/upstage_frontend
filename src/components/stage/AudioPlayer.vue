<script>
import { computed, onMounted, watch } from "vue";
import { message } from "ant-design-vue";
import { useStageStore } from "@stores/pinia/stage";
import { animate } from "animejs";
export default {
  setup: () => {
    const stageStore = useStageStore();
    const stopAudio = (audio) => {
      stageStore.updateAudioStatus({
        ...audio,
        isPlaying: false,
        currentTime: 0,
      });
    };
    const audios = stageStore.audios;
    let refs = [];
    const setRef = (el) => {
      const index = refs.length;
      refs.push(el);
      if (el) {
        el.addEventListener("ended", function () {
          const audio = audios[refs.indexOf(el)];
          if (audio.loop) {
            el.currentTime = 0;
            el.play();
          } else {
            stopAudio(audios[refs.indexOf(el)]);
            el.currentTime = 0;
          }
        });
        el.addEventListener("loadedmetadata", function () {
          stageStore.UPDATE_AUDIO_PLAYER_STATUS({
            index,
            duration: el.duration,
          });
        });
        el.addEventListener("timeupdate", function () {
          stageStore.UPDATE_AUDIO_PLAYER_STATUS({
            index,
            currentTime: el.currentTime,
          });
        });
        el.addEventListener("error", function () {
          const audio = audios[refs.indexOf(el)];
          const label = audio?.name || audio?.src || "audio";
          message.error(
            `Could not play ${label}. This format may not be supported in your browser.`,
          );
          stopAudio(audio);
        });
      }
    };

    const fadeVolume = (audio, volume, duration = 1000) => {
      animate(audio, {
        volume,
        duration,
        ease: "linear",
      });
    };

    const speed = computed(() => {
      if (stageStore.replay.isReplaying) {
        return Math.min(stageStore.replay.speed, 8);
      }
      return 1;
    });

    const handleAudioChange = () => {
      audios.forEach((audio, i) => {
        if (audio.changed) {
          if (audio.isPlaying) {
            refs[i].playbackRate = speed.value;
            refs[i].play();
          } else {
            refs[i].pause();
          }
          if (audio.saken) {
            refs[i].currentTime = audio.currentTime ?? 0;
          }
          fadeVolume(refs[i], (audio.volume ?? 1) * stageStore.masterAudioVolume);
          audio.changed = false;
          audio.saken = false;
        }
      });
    };

    // Master volume / "fade out all" — re-apply the global level to every
    // element over the fade duration carried by the signal. Replacing the
    // signal object (in the store) guarantees this fires on each change.
    const applyMasterVolume = (sig) => {
      audios.forEach((audio, i) => {
        if (!refs[i]) return;
        fadeVolume(refs[i], (audio.volume ?? 1) * sig.volume, sig.duration);
      });
    };

    watch(audios, handleAudioChange);
    watch(() => stageStore.masterAudioSignal, applyMasterVolume);
    onMounted(handleAudioChange);

    return { audios, setRef };
  },
};
</script>

<template>
  <!--
    Bind the asset URL directly to the <audio> element. Previously this
    template wrapped four <source> tags with mismatched MIME types
    (audio/mpeg, audio/ogg, audio/wav, audio/x-aiff) all pointing at the
    SAME `audio.src` URL. That produced misleading hints across browsers:
    Safari, which doesn't decode Vorbis/Opus, would accept the audio/mpeg
    hint, fetch the URL, fail to decode, then walk the same URL three
    more times under different `type` hints — net effect: silently broken
    on Safari for non-MP3/WAV uploads.

    The <object>/<embed>/<param> fallback targeted the Netscape Plugin
    API, which has been removed from every modern browser since ~2018,
    so it was dead code. We now let the browser sniff the format from
    the response Content-Type — works uniformly in Chromium / Firefox /
    Safari for any container the browser can decode natively.
  -->
  <audio v-for="audio in audios" :key="audio" :ref="setRef" :src="audio.src" preload="auto" />
</template>

<style scoped>
audio {
  display: none;
}
</style>
