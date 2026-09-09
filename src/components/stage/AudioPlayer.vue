<script>
import { computed, onMounted, watch } from "vue";
import { message } from "ant-design-vue";
import { useStageStore } from "@stores/pinia/stage";
import { animate } from "animejs";

// See the undecodable-file detection in `setRef` below. Exported for tests.
export const INSTANT_END_MS = 500;
export const INSTANT_END_MIN_REMAINING_S = 1;

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
    // Track → <audio> element. Keyed by the track object itself (the v-for
    // is `:key="audio"`, so an element is bound to one track for its whole
    // life). This replaced an index-based `refs` array that grew on every
    // re-render: Vue re-invokes a function ref on each patch, so each
    // element was pushed again and its listeners registered again.
    // Measured on the deployed dev bundle 2026-09-10: every element had
    // `ended`/`timeupdate` bound twice (double stop messages, double
    // loop-restart), and a track added after the first render (a media
    // assignment while the stage is open) got a status index past the end
    // of the list — its play command reached the FIRST element instead,
    // and its timer updates landed on a phantom row.
    const elementFor = new Map();
    const wired = new WeakSet();
    // Index the toolbox reads `audioPlayers[i]` with — resolved at event
    // time so it always matches the track's current position.
    const indexOf = (audio) => audios.indexOf(audio);
    const setRef = (el, audio) => {
      if (!el) {
        if (elementFor.get(audio) !== undefined) elementFor.delete(audio);
        return;
      }
      elementFor.set(audio, el);
      // A track added with `changed` already set (assignment or scene load
      // while on stage) is skipped by the watcher pass that runs before its
      // element exists; apply it now that the element is here.
      if (audio.changed) queueMicrotask(() => handleAudioChange());
      if (!wired.has(el)) {
        wired.add(el);
        // Undecodable-file detection. A mislabelled upload (e.g. an MP4
        // container saved as `.mp3`) loads fine in Chromium/Brave —
        // metadata, duration, no `error` event — but `play()` jumps
        // straight to the end and fires `ended` within milliseconds. The
        // handler below then reset it to 0 (and, with loop on, restarted
        // it, spinning play → ended → seek forever), so the performer saw
        // "goes immediately to zero, never plays" with no explanation.
        // Remember where/when the last play started; an `ended` that
        // arrives within INSTANT_END_MS of a start that still had more than
        // INSTANT_END_MIN_REMAINING_S to play is reported and stopped
        // instead. Seeking near the end and genuinely short clips fall
        // outside both bounds, so normal playback is untouched.
        let playStartedAt = 0;
        let playStartedFrom = 0;
        el.addEventListener("play", function () {
          playStartedAt = performance.now();
          playStartedFrom = el.currentTime;
        });
        el.addEventListener("ended", function () {
          const remaining = (isFinite(el.duration) ? el.duration : 0) - playStartedFrom;
          if (
            remaining > INSTANT_END_MIN_REMAINING_S &&
            performance.now() - playStartedAt < INSTANT_END_MS
          ) {
            const label = audio?.name || audio?.src || "audio";
            message.error(
              `Could not decode ${label}: it ended as soon as it started. The file may be damaged or not really the format its name suggests (e.g. an MP4 saved as .mp3). Re-export it as MP3/WAV and upload again.`,
            );
            stopAudio(audio);
            el.currentTime = 0;
            return;
          }
          if (audio.loop) {
            el.currentTime = 0;
            el.play();
          } else {
            stopAudio(audio);
            el.currentTime = 0;
          }
        });
        el.addEventListener("loadedmetadata", function () {
          stageStore.UPDATE_AUDIO_PLAYER_STATUS({
            index: indexOf(audio),
            duration: el.duration,
          });
        });
        el.addEventListener("timeupdate", function () {
          stageStore.UPDATE_AUDIO_PLAYER_STATUS({
            index: indexOf(audio),
            currentTime: el.currentTime,
          });
        });
        el.addEventListener("error", function () {
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
      audios.forEach((audio) => {
        if (audio.changed) {
          const el = elementFor.get(audio);
          // The element mounts on the render after the track is added;
          // leave `changed` set so the next watcher pass applies it.
          if (!el) return;
          if (audio.isPlaying) {
            el.playbackRate = speed.value;
            el.play();
          } else {
            el.pause();
          }
          if (audio.saken) {
            el.currentTime = audio.currentTime ?? 0;
          }
          fadeVolume(el, (audio.volume ?? 1) * stageStore.masterAudioVolume);
          audio.changed = false;
          audio.saken = false;
        }
      });
    };

    // Master volume / "fade out all" — re-apply the global level to every
    // element over the fade duration carried by the signal. Replacing the
    // signal object (in the store) guarantees this fires on each change.
    const applyMasterVolume = (sig) => {
      audios.forEach((audio) => {
        const el = elementFor.get(audio);
        if (!el) return;
        fadeVolume(el, (audio.volume ?? 1) * sig.volume, sig.duration);
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
  <audio
    v-for="audio in audios"
    :key="audio"
    :ref="(el) => setRef(el, audio)"
    :src="audio.src"
    preload="auto"
  />
</template>

<style scoped>
audio {
  display: none;
}
</style>
